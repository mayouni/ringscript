# Two O(n²) behaviours in `rlist.c`, and one root cause

**Status: prepared, not sent.** Nothing about these findings has been filed
upstream. Checked before writing (2026-08-10):

| where | what is there |
|---|---|
| [#1639](https://github.com/ring-lang/ring/pull/1639) | `private` inside `eval` + `strtod`/errno on musl — different findings, closed |
| [#1640](https://github.com/ring-lang/ring/pull/1640) | making `RING_VM_*` flags settable — different, closed |
| [#1641](https://github.com/ring-lang/ring/pull/1641) | the RingPM registry entry — **merged**. Its body offers these two fixes "separately if useful"; no proposal was made |
| the Google Group | no message sent. The only draft there, [the string-argument copy](group-message-string-copy.md), is still unsent |

So this is new, and the offer in #1641 was left open rather than taken up.

Channel: `ring-lang/ring` has **issues and discussions disabled**, so a pull
request is the only written channel besides the group.

---

## The proposal, ready to paste

**Title:** `rlist.c: random list access is O(n²) — one-line reproduction, and the fix`

---

Hello Mahmoud,

Two quadratic behaviours in `rlist.c`, both reproducible on **stock Ring
1.27** with no extensions, and both traceable to one cause. I have working
patches, but the finding matters more than my diff — you may well implement
it differently in PWCT.

### 1. Reading a list out of order is O(n²)

`ring_list_getitem()` keeps a **cursor** (`pLastItem` / `nNextItem`). That
makes sequential access O(1) and does nothing for random access, which falls
through to a linear walk — and the walk is never remembered, so the next
access walks again.

Save this as `access.ring`:

```ring
func Main
    aArg = sysargv
    cMode = aArg[3]
    n = number(aArg[4])

    aList = []
    for i = 1 to n
        aList + i
    next

    nSum = 0
    t1 = clock()
    if cMode = "perm"
        for i = 1 to n
            nSum += aList[ ((i * 7919) % n) + 1 ]
        next
    else
        for i = 1 to n
            nSum += aList[i]
        next
    ok
    t2 = clock()
    see "" + cMode + " " + n + " " + ((t2-t1)/clockspersecond()*1000) + " ms  sum=" + nSum + nl
```

Same list, same number of reads, identical checksum. **Only the order
differs**:

| n | `aList[i]` in order | through a permutation | ratio |
|---:|---:|---:|---:|
| 5,000 | 1 ms | 7 ms | 7× |
| 10,000 | 1 ms | 30 ms | 30× |
| 20,000 | 2 ms | 133 ms | 66× |
| 40,000 | 2 ms | 459 ms | 230× |
| 80,000 | 6 ms | 1,701 ms | 283× |

Sequential is linear. Permuted **quadruples per doubling** — quadratic.
(Ring 1.27, Windows, Intel Core 5 210H; a second run reproduced every row.)

The permutation is not exotic: `((i * 7919) % n) + 1` is just "read the rows
in a different order than they are stored", which is what a sorted view, an
index, a lookup table or a join produces.

**The fix** — in `ring_list_getitem()`, at the point where the cursor has
already failed and the code is about to walk:

```c
if (lUseListCache && pList->nSize > RING_LIST_ARRAYONRANDOMACCESS) {
    ring_list_genarray_gc(pState, pList);
    if (pList->pItemsArray != NULL) {
        return pList->pItemsArray[nIndex - 1];
    }
}
```

Build the items array once and answer from it. Why this is safe rather than
brave:

- every structural mutation already calls `ring_list_clearcache_gc()`, which
  frees the array — it cannot go stale;
- `ring_list_genarray_gc()` does not call back into `ring_list_getitem()`,
  so there is no recursion;
- small lists keep walking (`RING_LIST_ARRAYONRANDOMACCESS`, 64) — below
  that an allocation costs more than the walk saves;
- the cost is one n-pointer allocation on the *first* random access, repaid
  on the second.

### 2. `sort(aList, nColumn)` is O(n²) — the same cause, most visible

`ring_list_sortnum_gc()` and `ring_list_sortstr_gc()` extract keys,
quicksort an index array, then rebuild the list by reading `pList` at
`idx[i]` — in sorted order, which is to say **randomly**. Without the items
array, each of those reads walks.

Same file as above, sorting `n` numbers as a flat list versus the same
values as `[key, index]` rows:

| n | `sort(aList)` | `sort(aList, 1)` |
|---:|---:|---:|
| 5,000 | 0 ms | 9 ms |
| 10,000 | 1 ms | 27 ms |
| 20,000 | 1 ms | 373 ms |

Flat stays flat; by-column explodes. Sorting rows by a column is what every
data table in every application does.

**The fix** — before the rebuild loop in both functions:

```c
if (nColumn != 0) {
    ring_list_genarray_gc(pState, pList);
}
```

### One note that may save you work

Fix 1 probably **subsumes** fix 2: once the accessor builds the array on its
first random read, the sort rebuild's first read would build it anyway. I
kept both because the explicit call in `sort` documents the intent and costs
nothing, but if you would rather carry a single change, the accessor is the
one that matters — fix 2 is one symptom of it, and joins, lookups and any
index-driven pass are others that no benchmark will show you.

### How I know it does not break anything

These have been running in **RingScript** (Ring 1.27 compiled to
WebAssembly) since August 2026, held by a differential battery: about 850
programs — the official `samples/`, every runnable snippet in the Ring
documentation, and a suite of gates — executed through both the patched VM
and stock `ring.exe`, compared **byte for byte**. Zero mismatches. That
corpus exists mainly because `ring_list_getitem()` is the VM's most-used
accessor and I was not willing to touch it on faith.

What the fix bought there: an aggregate pass over a sorted 20,000-row table
went 1,162 → 96 ms, and at 50,000 rows 19,758 → 277 ms.

I am happy to send this as a patch, split it, or leave it as a report — and
equally happy for you to reimplement it in PWCT, which I understand is where
Ring is actually authored. Whatever is most useful.

Thank you for Ring.

Mansour

---

## Reproduction files

Kept in the repository so the numbers above can be re-run at any time:

- [`tests/upstream/access.ring`](../../tests/upstream/access.ring) — finding 1
- [`tests/upstream/sortcase.ring`](../../tests/upstream/sortcase.ring) — finding 2

```bash
# stock Ring 1.27, not RingScript
ring tests/upstream/access.ring   perm 80000
ring tests/upstream/sortcase.ring rows 20000
```

## Measuring note, for the record

An early pass measured on **Ring 1.26**, where the *flat* sort is itself
pathological (2,202 ms at 20,000 rows against 1 ms on 1.27). That would have
buried finding 2 in noise and made the whole table look like a Ring-wide
slowdown rather than a specific quadratic. Everything above is 1.27 — the
version RingScript vendors and the version the report is about.
