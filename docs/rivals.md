# RingScript vs. its peers

*Every other number in these docs is absolute. This page gives them
context: the same scenarios, run through two other C interpreters
compiled to WebAssembly, under the same measurement discipline
(minimum of many runs, correctness probed before any timing is
believed). Harness: [`tests/rivals/`](../tests/rivals/run.js).*

Two honesty rules, or a page like this is marketing:

- **Each language gets idiomatic code** — the same algorithm, written
  the way that language's programmer would write it.
- **Losses are published with the wins.** The point is to find the
  headroom, not to win.

## The scoreboard, kept current

The first run of this harness (August 7, 2026, morning) became the
work list in [HEADROOM_PLAN.md](HEADROOM_PLAN.md); the numbers below
are the re-run after P1 (snapshot instancing) and P2 (the C JSON
codec) landed the same day. The original table further down is kept
verbatim as the before-picture.

| scenario (min ms) | ring | lua | js | winner | was (ring) |
|---|---|---|---|---|---|
| fresh evaluator | 3.34 | 0.15 | 0.13 | peers | 6.70 |
| assign a global | 0.046¹ | 0.002 | 0.003 | lua | 0.095 |
| 10,000-iteration loop | 0.654² | 0.058 | 0.403 | lua | 0.738 |
| build a 2,000-char string | **0.203²** | 0.301 | 0.667 | **ring** | 0.282 |
| copy + sort 2,000 numbers | **0.212²** | 0.370 | 0.835 | **ring** | 0.294 |
| create 2,000 objects | 6.120 | 0.205 | 0.612 | lua | 6.262 |
| JSON encode ~8.7 KB | **0.185** | 0.723 | 0.420 | **ring** | 10.4 |
| JSON decode ~8.7 KB | 0.719 | 1.153 | 0.198 | js | 32.7 |
| 1 MB through JSON | **1.542** | 76.4 | 8.0 | **ring** | 944.6 |

¹ 0.046 after P3 (the auto-main skip); 0.043 after P4.
² After P4 (computed-goto dispatch + `-O2` VM core), same day.

Ring's wins went from two rows to **four of nine** in one day of
executing the plan — including JSON encode, where Ring now beats
QuickJS's *native* codec, and the 1 MB row, won outright against
everyone. (Ring's and QuickJS's JSON are C now; Lua's stays pure Lua —
that column measures what a C codec buys.) The robustness tables below
re-ran identically: heap flat everywhere, zero deaths everywhere.

The remaining open item is object creation (P5). Dispatch closed to
~1.5× of QuickJS under P4; Lua's fused loop opcode stays a design
generation ahead, as the plan said it would.

## The contenders

| | wasm size | eval API | errors |
|---|---|---|---|
| **Ring 1.27** (RingScript) | 371 KB | `ring.eval(code)` | returned as `{ok:false}` |
| **Lua 5.4** ([wasmoon](https://github.com/ceifa/wasmoon)) | 271 KB | `lua.doStringSync(code)` | thrown (its contract) |
| **QuickJS** ([quickjs-emscripten](https://github.com/justjake/quickjs-emscripten)) | 519 KB | `ctx.evalCode(code)` | returned as a handle |

Same weight class, same architecture: a C interpreter, compiled to
wasm, holding resident state between evals. Lua is the closest
structural twin; QuickJS is the strongest small interpreter in the
business, so it marks the ceiling.

## Robustness: parity, which is the headline

Measured on the two suites RingScript takes most seriously:

| | 10,000 evals with errors mixed in | 1,200 identical garbage inputs |
|---|---|---|
| Ring | heap **+0.00 MB**, survived | 0 deaths |
| Lua | heap **+0.00 MB**, survived | 0 deaths |
| QuickJS | heap **+0.00 MB**, survived | 0 deaths |

Nobody leaks on the page workload, nobody dies on garbage, everybody
keeps answering afterwards. Before P0, RingScript would have **failed
the endurance row** — the class-per-eval leak was exactly this shape —
so this table is what the P0–P5 work bought: a seat at a table where
mature interpreters sit. (Ring "accepts" more garbage than the others —
22 vs 3 and 7 of 1,200 — because Ring's grammar treats more stray text
as valid programs. Accepting garbage quietly is not a crash, but it is
worth knowing.)

## Speed: the first measurement (the before-picture), and what each ratio taught

Intel Core 5 210H, Node 22, min of many runs:

| scenario (min ms) | ring | lua | js | winner |
|---|---|---|---|---|
| fresh evaluator | 6.70 | 0.15 | 0.14 | peers¹ |
| assign a global | 0.095 | 0.002 | 0.002 | lua |
| 10,000-iteration loop | 0.738 | 0.058 | 0.393 | lua |
| build a 2,000-char string | **0.282** | 0.300 | 0.675 | **ring** |
| copy + sort 2,000 numbers | **0.294** | 0.377 | 0.829 | **ring** |
| create 2,000 objects | 6.262 | 0.200 | 0.620 | lua |
| JSON encode ~8.7 KB² | 10.4 | 0.724 | 0.419 | js |
| JSON decode ~8.7 KB² | 32.7 | 1.159 | 0.197 | js |
| 1 MB string through JSON² | 944.6 | 78.5 | 7.733 | js |

¹ Asymmetric on purpose, and labeled: RingScript's loader recompiles
the wasm for every instance; wasmoon and quickjs-emscripten compile
once and share the module. See finding 5.
² Ring and Lua run codecs written in the language itself; QuickJS's
JSON is native C. That row measures what a C codec buys, not parser
quality.

### 1. Where RingScript wins — and why

**String building** and **sorting**. Ring's `+=` is amortised (the
JSON hardening measured this: appends are linear), while Lua's
immutable strings pay a fresh allocation per concatenation and QuickJS
sits in between. `sort()` lands in the VM's C sort. The pattern behind
both wins: **when the work lands in the vendored C, Ring is
competitive with anyone.**

### 2. The eval round trip costs ~0.1 ms — that is overhead, not execution

Assigning one global takes Ring 50× longer than the peers. The
difference is everything wrapped around the user's code: the keyword
scan for the region terminator, the eval shim
(`try eval(rs_getcode()) catch ... done`) which routes through Ring's
own `eval()`, the auto-`main` check. For a page calling `ring.eval` on
a click, 0.1 ms is nothing. For anything calling it in a tight loop,
this dominates before the user's code runs a single statement — batch
the work into one eval instead.

### 3. Dispatch is in QuickJS's neighborhood; Lua is in another class

The 10,000-iteration loop puts Ring within **1.9×** of QuickJS — a
respectable place for an interpreter that never had a bytecode
redesign. Lua is 12.7× faster than Ring here, but Lua is 6.8× faster
than *QuickJS* too: register-based dispatch with a fused loop opcode
is simply a different design generation. Context, not indictment.

### 4. Object creation and the pure-Ring JSON codec are the two real headrooms

- `new` on a three-attribute class costs Ring **31×** Lua's table
  literal and 10× QuickJS's `new`. Ring's class-region machinery runs
  per instantiation; that is the single largest interpreter-side gap.
- The honest JSON comparison is **pure codec vs. pure codec**: Lua's
  `json.lua` decodes the same 8.7 KB **28× faster** than Ring's
  `json.ring`. Neither touches native JSON — the difference is that
  Lua's `string.find`/`sub`/`gsub` are C primitives a codec can lean
  on, while Ring's codec walks bytes in interpreted code because no
  equivalent scanning primitive exists. The sliding-window rewrite
  bought linearity; the next multiple lives in **one C-level "find
  next byte of interest" helper** in the bridge — or upstream in Ring.

  *Executed as [HEADROOM_PLAN.md](HEADROOM_PLAN.md) P2 — the codec
  itself moved to C, held byte-identical to the pure reference by a
  permanent gate. Ring now wins JSON encode outright (0.19 ms, ahead of
  QuickJS's native codec) and the 1 MB row against everyone (1.5 ms).*

### 5. The fresh-evaluator gap is mostly self-inflicted, and fixable

6.7 ms vs 0.15 ms is not interpreter quality: the loader calls
`WebAssembly.instantiate(bytes)` per instance, recompiling 371 KB of
wasm every time, then `rs_init` parses the embedded ringlib. The peers
compile once and instantiate many. Caching the compiled
`WebAssembly.Module` in the loader would close most of the gap for
pages that create instances repeatedly (the Playground creates one per
run). This is the most actionable single item on this page.

*Executed as [HEADROOM_PLAN.md](HEADROOM_PLAN.md) P1 — and the
measurement corrected the diagnosis: the compile was only ~1.1 ms of
the 6.7; the bulk was init. A post-init memory snapshot now stamps
every later instance: **6.7 → 3.3 ms**.*

## Running it

```bash
cd tests/rivals
npm install        # wasmoon + quickjs-emscripten, ~10 packages
node run.js        # full run, a few minutes
node run.js --quick
```

Not part of CI: it needs npm dependencies the runtime itself must
never grow, and its numbers are for learning, not gating —
[`tests/bench.js`](../tests/bench.js) remains the regression gate.
Results behind this page: [`tests/rivals/results.json`](../tests/rivals/results.json).

## What this page is not

A single machine, Node rather than a browser, and three engines that
made different trade-offs (Lua ships no JSON at all; QuickJS ships a
C one; Ring ships a pure-Ring one so the same file runs natively).
The scoreboard is not the product — the product is the list above of
where RingScript's next multiple is known to live. That list became a
plan: [HEADROOM_PLAN.md](HEADROOM_PLAN.md).
