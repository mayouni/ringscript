# Working with data — the register app, measured

*A working savings-circle register, running inside RingScript:
[playground/ledger.html](../playground/ledger.html), with its Ring source
in [playground/ledger.ring](../playground/ledger.ring). It exists to answer
one question honestly, and it found four things worth fixing while doing
so — two of them bugs in the Ring VM.*

## The question it asks

The question every application eventually asks of its platform:

> **Can a Ring page carry a normal application data load — and feel right
> to use while doing it?**

"Feels right" is not an opinion here. It is three thresholds that come from
how people perceive delay, and they do not care what language you chose:

| | budget | what the user experiences |
|---|---|---|
| **instant** | under 16 ms | inside one animation frame; the result is simply *there* |
| **responsive** | under 100 ms | feels caused by the click |
| **noticeable** | over 100 ms | the page is visibly thinking |

So every interaction is measured against those, and the page labels each
one. JavaScript is present, but only as a **referee**: it recomputes every
answer from the same data and marks it ✓ or ✗. It has no timing column —
"is Ring correct" is the question worth asking of it.

## The shape of the app — and why the shape is the point

A savings circle: members put money into numbered rounds. The page does
what every data page does.

**The data is loaded once and then lives inside the VM.** That is the whole
reason a resident runtime exists. `ledger.ring` holds the ledger in Ring
globals — as columns, one list per field — and every later interaction
works on that copy. Nothing crosses the bridge again except the answer.

```
   the page                     the resident Ring VM
┌──────────────┐   load once  ┌────────────────────────┐
│ filter box   │ ───────────► │ aRowMember  aRowAmount │
│ table header │              │ aRowRound   aRowStatus │
│ add form     │ ── call ───► │ aView  ← what is shown │
│ pager        │ ◄── answer ─ │                        │
└──────────────┘              └────────────────────────┘
```

Seven interactions, each one Ring function:

| | interaction | what it does |
|---|---|---|
| 1 | **load** | the only JSON crossing; builds the columns |
| 2 | **filter** | runs on every keystroke, over the whole ledger |
| 3 | **sort** | what a column-header click does |
| 4 | **page** | hands back the 25 rows actually drawn |
| 5 | **validate** | runs per keystroke in the add form |
| 6 | **add** | appends one deposit, keeps the view honest |
| 7 | **leaderboard** | aggregates over the rows currently shown |

## What it costs

Measured in Node, so the numbers are not distorted by tab throttling — an
early browser run reported figures 10–25× worse purely because the pane was
in the background, which is a lesson about measuring, not about Ring.

| interaction | 20,000 deposits | 50,000 deposits |
|---|---|---|
| draw a page | 0.2 ms · instant | 0.4 ms · instant |
| recompute totals | 11 ms · instant | 28 ms · responsive |
| filter | 15 ms · instant | 38 ms · responsive |
| sort a column | 53 ms · responsive | 130 ms · noticeable |
| leaderboard | 92 ms · responsive | 238 ms · noticeable |
| **load, once** | **106 ms** | **879 ms** |

**At 20,000 rows everything a user touches is instant or responsive.** At
50,000, two interactions cross the line and are honestly labelled as such.
That is the answer to the question, and it is a good one — but it is not
the answer this app gave on its first run.

## The four things it found

Every one of these was invisible at benchmark sizes and painful at page
sizes. None would have surfaced from a synthetic loop.

### 1. `sort(list, nColumn)` was O(n²) — VM bug, fixed

Ring's sort extracts keys, quicksorts an index array, then rebuilds the
list by reading it at `idx[i]` — in sorted order, which is to say randomly.
Without the items array, every read walks the linked list.

| rows | flat list | `[key, index]` pairs |
|---|---|---|
| 2,500 | 0.4 ms | 2.3 ms |
| 5,000 | 0.6 ms | 8.0 ms |
| 10,000 | 1.3 ms | 39 ms |
| 20,000 | 4.0 ms | **257 ms** |

Quadrupling per doubling. Generating the items array before the rebuild
fixes it: **257 → 16 ms**. ([Vendor patch 7](VENDOR_PATCHES.md).)

### 2. Random list access walked the list, every time — VM bug, fixed

The deeper one. Ring's list cache is a **cursor**: it makes sequential
access O(1) and does nothing at all for random access, which falls through
to a linear walk and is never remembered. So any pass over a large list
through a permuted index — *"sort the table, then total the visible rows"*,
the most ordinary thing a data page does — is O(n²).

| | before | after |
|---|---|---|
| totals over 20,000 rows | 377 ms | **11 ms** |
| leaderboard over 20,000 rows | 1,162 ms | **96 ms** |
| totals over 50,000 rows | 5,751 ms | **31 ms** (184×) |
| leaderboard over 50,000 rows | 19,758 ms | **277 ms** (71×) |

The fallback now builds the items array once and answers from it. Every
structural mutation already frees it, so it cannot go stale.
([Vendor patch 8](VENDOR_PATCHES.md).)

### 3. Ask your API for rows, not objects — no VM change, 15× on load

The first load took 7.9 seconds at 50,000 rows. Splitting it apart showed
column-building was perfectly linear and decoding was not — but decoding
the *same payload twice in one VM* told the real story:

```
20k rows, first decode   1025 ms   heap  21 → 109 MB
20k rows, second decode   195 ms   heap 109 → 111 MB
```

Steady-state decoding is linear. **About 80% of a first load is one-time
heap growth**, and pre-growing the memory does not help — `memory.grow`
itself costs nothing; what costs is first-*touching* tens of megabytes of
fresh pages.

So the fix was not to parse faster but to need less memory. 20,000
five-field records were taking 88 MB — **4.4 KB per record for 60 bytes of
JSON** — because a JSON *object* decodes into a pair-list: one list for the
record, one list per field, two items per field. An array *row* is one list
and one item per field.

| same 20,000 deposits | payload | decode | heap |
|---|---|---|---|
| `[{"id":1,"member":"m03",…}]` | 1.31 MB | 1358 ms | +89 MB |
| `[[1,"m03",3,250,"ACTIVE"]]` | 0.55 MB | **71 ms** | **+23 MB** |

`LedgerLoad` accepts both shapes — a real API may send either — and the
page sends rows. Load went **7.9 s → 0.88 s** at 50,000.

### 4. Five Ring rules that shape how the code is written

Learned by getting them wrong first. They are at the top of
[`ledger.ring`](../playground/ledger.ring) so the next person meets them
before the bug does.

1. **Every function called from the page takes exactly one parameter** —
   that is what `ring.call` passes, so a zero-parameter function just
   errors. (Two "scope gotchas" turned out to be this.)
2. **Do not name a function after a builtin.** `func Load` collides with
   Ring's `load` and silently fails to define.
3. **Globals are reachable from functions**, to read *and* to write.
4. **Index the loop, hoist the length, append with `+`.** `for x in aList`
   hands back a *copy* of every item; `len()` in a loop signature
   re-evaluates. Applying this to the ledger's sibling app cut 13% off it.
5. **Assignment copies.** `o = aList[i]` gives you a copy — writing to it
   changes nothing. Index straight through: `aList[i][2] = …`.

## What this proves, and what it does not

**It proves** the runtime is sound for real data work at real sizes: a
20,000-row page is instant to filter, sort and total, and every answer it
produces is identical to JavaScript's, checked live. All ~850 oracle
programs still match native `ring.exe` byte-for-byte after both VM patches.

**It does not prove** Ring is as fast as JavaScript — it is not, and the
[rivals page](rivals.md) measures that honestly elsewhere. It also does not
speak for 500,000-row workloads, where sort and aggregation would need a
different approach than a linear scan.

The useful claim is narrower and more durable: **an ordinary Ring page, at
the sizes ordinary pages carry, feels like a page.** And the way to keep
that true is to keep driving real applications, because that is what found
all four items above.

## Running it

```bash
zig build serve      # then open http://localhost:8377/ledger.html
```

Or open the deployed copy from the site. Change the row count, type in the
filter box, click the headers, add a deposit — the interaction log at the
bottom fills in as you go, with the verdict for each one and the referee's
tick beside it.
