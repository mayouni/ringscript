# Vendor patches to ringvm/

`ringvm/` is the vendored Ring VM source, currently **Ring master at
[`8a89cc00c2`](https://github.com/ring-lang/ring/commit/8a89cc00c2)**,
taken 2026-08-16. It carries **four** live RingScript patches, each marked
with a `RINGSCRIPT PATCH` comment at the site. **Any future vendor swap
must re-apply them** — then run `zig build` and `node tests/gates.js` (the
P2 line-number gates fail if the eval patches are missing).

## What the base is, precisely

Not "1.28", despite what upstream's version macro says. Measured file by
file, master is **stock 1.27 plus 91 changed lines** across 12 `.c` files
and 2 headers, and every one of them is a correction — there is no feature
in the delta. RingScript therefore reports `1.27`, which is patch 3 below.

The swap that brought it here landed 2026-08-16 and **retired three local
patches by making them upstream code**: 3 (`private` in eval), 4
(strtod/musl) and 7 (the `sort` quadratic) are now in Ring itself. Their
sections are kept, emptied, so the numbering in older writing still
resolves — and because a patch that comes back as upstream code is the
outcome worth recording, not the one worth deleting.

Patch numbering runs 1, 2, 3(new), 5, 6 — the live set is **1, 2, 3, 5, 6**
minus the retired ones, which is four patches wearing five numbers. The
slots are cheap; a renumbering that silently invalidates every earlier
reference is not.

## 1. `ringvm/src/vmeval.c` — keep line numbers in eval'd bytecode

Upstream wraps the eval parser call in `lNoLineNumber = 1 … = 0`, which
strips `ICO_NEWLINE` instructions from eval'd code. The bridge runs all
user code through `eval()` (the try/catch shim in `bridge.zig`), so that
would freeze `pVM->nLineNumber` at the try-entry line. The patch removes
the forcing so the state's flag (default 0) is respected.

## 2. `ringvm/src/vmerror.c` — capture the failing line at error time

Adds a global `unsigned int rs_error_line` set from `pVM->nLineNumber`
at the top of `ring_vm_error()` (after the active-error guard). Needed
because `ring_vm_catch → ring_vm_restorestate` rewinds the VM's line
number to its try-time value *before* the catch block runs — by the time
`rs_reporterror` fires, the line is gone from the VM. The bridge reads
`rs_error_line` via `extern var` (bridge.zig).

Together these make `rs_last_error()` report the real failing line for
multi-line evals (e.g. an error on line 3 reports `line 3: …`).

## 3. `ringvm/include/state.h` — report 1.27, not 1.28

*This slot previously held the `private`-inside-eval fix. That landed
upstream as [`7acf95bf`](https://github.com/ring-lang/ring/commit/7acf95bf)
and arrived with the 2026-08-16 swap; the local patch is gone.*

Upstream master has already bumped its version macro toward the next
release. This tree pins `RING_VERSION_MINOR` and `RING_STATE_VERSION` back
to `1.27`, because that is what the code is: 1.27 plus 91 lines of fixes,
no features.

The version a user tests against matters more than the commit the source
came from. They write Ring, run it against the 1.27 they can download, and
expect the browser to agree — and the differential oracle does exactly the
same, comparing every sample to the stock 1.27 interpreter. Claiming 1.28
would make `version()` disagree with the interpreter it behaves identically
to. It is not a hypothetical: the first sweep after the swap came back with
**one** mismatch out of 237 programs, and it was this line.

**Flip it** the day 1.28 ships, or the day this tree takes a 1.28 feature
rather than a 1.27 fix — whichever comes first.

## 4. RETIRED — strtod errno portability (musl vs MSVC)

*Carried from the wasm port, removed 2026-08-16 when it arrived upstream as
[`4014382a`](https://github.com/ring-lang/ring/commit/4014382a).*

In `ring_vm_stringtonum`, the error branch fired when `strtod` returned 0
with `errno` set. On no-conversion input, musl (wasi-libc) sets `errno` to
EINVAL while MSVC/glibc leave it untouched — so `"test" = 5` raised `R41
Invalid numeric string` under wasm where native prints `0`. The fix is a
`cStr != cEndStr` guard, and upstream's is the same guard in the same
place.

**A portability bug only a musl build could see, fixed for every musl
build.** That is the whole argument for reporting upstream rather than
carrying a patch.

## 5. `ringvm/src/vm.c` — the computed-goto dispatch loop, written

The vendor scaffolded this one and left it to be filled in: `vm.h`
declares `ring_vm_computedgoto()` under `#ifdef RING_VM_COMPUTEDGOTO`,
`ring_vm_mainloop()` calls it, and the comment says it "must be written
if RING_VM_COMPUTEDGOTO is enabled". The patch appends that function,
GENERATED mechanically from `ring_vm_execute()`'s switch — one label per
opcode, bodies identical, label table in `codegen.h` enum order — so
fetch, dispatch and the stack check live in one loop with no function
call per instruction.

Purely additive and guarded: without `-DRING_VM_COMPUTEDGOTO`
(build.zig sets it) the file compiles exactly as stock. Measured in
wasm: nothing at `-Os` (clang lowers switch and goto to the same
`br_table`), a consistent ~9% on dispatch-bound code once the VM core
is compiled `-O2`. Behavior is held identical by the oracle battery
(~850 programs byte-exact vs native). If the opcode enum ever changes,
the function must be regenerated — a stale table dispatches the wrong
opcode. Worth offering upstream, since the hook is the vendor's own.

## 6. `ringvm/src/vmoop.c` — one call out to the object template cache

`new X` on an attributes-only class re-executes the class-region
bytecode on every instantiation, wrapped in a full VM state save/restore
— identical work producing identical NULL attributes each time
(measured: 31x a Lua table). The patch is two lines in
`ring_vm_oop_newobj`: an extern declaration and one guarded call, placed
where the state save was about to happen. Everything else — the static
region-bytecode scan that proves a class is bare-attributes-only, the
name table, the replay, Ring's documented global-vs-attribute conflict
rule (any cached name visible as a global falls back to the normal
path), the reset lifecycle — lives in RingScript's own `src/rs_oop.c`.
Ineligible classes (defaults, private sections, parents, executable
statements) never leave the stock path. Held identical by the gates'
oop phase (written against the unpatched VM first) and the full oracle
battery, which caught and now guards the conflict rule.

## 7. RETIRED — `sort(list, nColumn)` was O(n²)

*Carried from 2026-08-08, removed 2026-08-16 when it arrived upstream —
**as the identical two hunks**, so the swap took the file whole and the
local patch simply disappeared.*

`ring_list_sortnum_gc` / `ring_list_sortstr_gc` extract keys, quicksort an
index array, then rebuild the list by reading `pList` at `idx[i]` — in
sorted order, which is to say randomly. Without the items array,
`ring_list_getitem` walks the linked list, so the rebuild is quadratic.

Measured on stock Ring, sorting `[key, index]` pairs: **2.3 / 8 / 39 /
257 ms** at 2.5k / 5k / 10k / 20k rows — quadrupling per doubling — while
sorting the same values as a flat list stayed linearithmic (0.4 / 0.6 /
1.3 / 4.0 ms). The fix calls `ring_list_genarray_gc()` before the rebuild
when `nColumn != 0`. After it: **0.9 / 2.1 / 6.0 / 16.4 ms**.

**Sorting rows by a column is what every data table does.** This is the
second local patch to be retired by upstreaming it rather than by being
abandoned, and the pattern is worth naming: a patch that is right for
everybody is a patch you should stop carrying.

## 8. WITHDRAWN — random list access building the items array

*Carried from 2026-08-08, removed 2026-08-14. The slot is kept so the
numbering in older writing still resolves.*

The patch made `ring_list_getitem_gc` build the items array when a random
access fell past the cursor, instead of walking. It worked: a leaderboard
pass over 20,000 sorted rows went 1,162 → 96 ms.

It was proposed upstream alongside patch 7 and **rejected**. Mahmoud
Fayed's reason: building the array is not free, a program that mixes
adding and reading creates and destroys it repeatedly, and one access
pattern does not generalise.

Checked rather than taken on trust — two runtimes identical but for the
change:

| 20,000 rows | patched | stock |
|---|---:|---:|
| permuted read | 5.8 ms | 207.9 ms |
| mixed add + read | 37.5 ms | 21.5 ms |
| mixed add + read, 50,000 | 125.1 ms | 53.7 ms |

**1.7–2.3× slower** when adds and reads interleave, widening with n. Any
structural change frees the array and the next random read rebuilds it
whole, so the patch turns an occasional O(n) rebuild into a per-iteration
one. The ~850-program oracle never caught it because none of those
programs does that at scale — the corpus proves correctness, not the
absence of a performance regression.

**What replaces it.** Ring already ships the mechanism, opt-in:
`ringvm_genarray(aList)`. `playground/ledger.ring` calls it through
`LedgerIndex()`, which marks the index stale on a write and rebuilds at
most once before the next read that needs it. Rebuilding on every add
instead costs 824 µs a row at 20,000 rows.

Measured against a build that still carried the patch, same Ring code,
the two agree to within noise:

| 20,000 rows | patch 8 | genarray, no patch |
|---|---:|---:|
| totals | 13 ms | 14 ms |
| leaderboard | 107 ms | 103 ms |
| paging | 18 ms | 21 ms |
| per add | 116 µs | 114 µs |

and at 50,000: leaderboard 277 / 271 ms, identical checksums. Full battery
green — gates, soak, fuzz, WASI, boot, examples oracle, 237 + 257 sweep
programs byte-exact with 0 mismatches, no bench regressions, and the wasm
331 bytes smaller.

---

# What the 2026-08-16 swap brought in

*The findings themselves, their reproductions, and what came back from the
Ring project live in **RingUpstream**. What stays here is only the part a
vendor swap has to act on.*

The queue said six fixes. **There were eleven**, because the six were the
ones somebody had filed and tracked, and nobody had diffed the tree. The
whole delta between stock 1.27 and master is 91 lines, so the difference
cost nothing to find — one `diff -r` — and would have cost a good deal to
discover later, one confusing behaviour at a time.

**The six that were tracked:**

| fix | landed as | what unpatched 1.27 does |
|---|---|---|
| `private` inside `eval()` | [`7acf95bf`](https://github.com/ring-lang/ring/commit/7acf95bf) | crashes; was vendor patch 3 |
| `strtod`/errno on musl | [`4014382a`](https://github.com/ring-lang/ring/commit/4014382a) | misparses at the edges; was vendor patch 4 |
| `memcpy()` zero-byte source | [`8675fe3a`](https://github.com/ring-lang/ring/commit/8675fe3a) | aborts the process |
| empty `catch` stack slot | [`cda2ecf0`](https://github.com/ring-lang/ring/commit/cda2ecf0) | leaks one slot per caught raise; R4 at ~1003 |
| name folding in four lookups | [`b6aea3d5`](https://github.com/ring-lang/ring/commit/b6aea3d5) | `varptr("nTotal")` raises R6; `ring_state_findvar` silently misses |
| operator overloading with a list element | [`05dc3f49`](https://github.com/ring-lang/ring/commit/05dc3f49) | the section below |

**The five that nobody was tracking**, found by diffing rather than by
reading a list:

| fix | file | what it does |
|---|---|---|
| `sort(list, nColumn)` quadratic rebuild | `rlist.c` | **RingScript's own patch 7, upstreamed verbatim** — same two hunks, same place |
| `load` path resolution + a filename-length guard | `scanner.c` | 1.27 copies the resolved path over the *original* on a miss, then reports the wrong name as missing |
| arguments-cache double-free guard | `vmgc.c` | a list in the arguments cache could escape to caller scope and be freed twice |
| hashtable rebuilt on the inherited methods list | `vmoop.c` | a copied methods list kept a stale hashtable after inheritance |
| `ring_parser_icg_retnull` simplified | `codegen.c`, `stmt.c` | 1.27 suppressed a RETNULL after RETURN; master always emits it |

Two mattered more here than elsewhere. **The empty-`catch` leak was a
RingScript problem specifically**: this project wraps *every* eval in a
try/catch shim, so a page evaluating ~1000 failing snippets hit `R4` in the
browser. And the `memcpy()` one aborts the whole process, which in a browser
means the tab.

## What the swap cost, measured

| | |
|---|---|
| upstream delta from stock 1.27 | 91 lines, 12 `.c` files, 2 headers |
| files taken from upstream whole | 10 |
| files merged by hand | 2 — `rlist.c` (upstream carries patch 7), `vmoop.c` (upstream fix + patch 6) |
| files kept unchanged | 3 — `vm.c`, `vmerror.c`, `vmeval.c`; upstream never touched them |
| local patches after | **4**, down from 7 |
| differential sweep | 237 exact, **0 mismatch**, 0 wasm failure |
| benchmarks | no regression on any of 11; wasm 174 bytes smaller |
| gates, examples oracle, fuzz, soak, stress | all clean |

**One swap, not six errands, was the right instruction** — but the reason is
not the one that was given. It is right because the delta is small enough to
read in full, which is what turns "apply six patches" into "take the file".

## The oracle is now behind the VM

Worth knowing before the next swap, because it will only grow.

`tests/samples-sweep.js` compares against the **stock 1.27 interpreter**,
which still has all eleven bugs. The vendored VM no longer does. So any
sample exercising a fixed path can no longer agree with the oracle, and
lands in one of two buckets:

- **the native side crashes** -- the sample is dropped as a `NATIVE FAIL`
  and never compared. `ProblemSolving/Lists/arrayvector2.ring` is exactly
  this: it kills stock `ring.exe`, and it runs correctly here, printing
  `V[4] = [14,12,15]`. **The swap fixed a shipped sample, and the oracle
  cannot see that it did.**
- **the native side runs and is wrong** -- a genuine `MISMATCH` where the
  VM is right and the reference is not.

Today the second bucket is empty: the sweep is 237 exact, 0 mismatch. The
only program that fell into it was the one printing `version()`, and that
is why patch 3 exists. But the margin is luck, not design.

**The fix, when it is needed: build the oracle's `ring.exe` from the same
source as the vendored tree.** The clone is already there in step 1 of the
recipe below, and Ring builds natively from it. Until then, read a rising
`NATIVE FAIL` count as a question rather than as noise -- it is where the
worst bugs sit, which is why they are listed by name in
`tests/sweep-failures.json` instead of only counted.

## Doing this again

1. `git clone --filter=blob:none https://github.com/ring-lang/ring.git`,
   sparse-checkout `language/src` and `language/include`.
2. `diff -rq` it against a **stock** 1.27 tree, not against `ringvm/` —
   the local patches drown the signal otherwise.
3. `diff -rq` stock against `ringvm/` to list which files carry patches.
   Anything in one list and not the other is a file you can take whole.
4. The intersection is the only hand work. Read those diffs; upstream may
   already have your patch.
5. `zig build`, then `node tests/samples-sweep.js`. **The sweep is the
   gate** — a byte-exact comparison against the native interpreter catches
   what a unit test cannot, and it caught the version string here.

## Operator overloading with a list element as the right operand

**Fixed here by the 2026-08-16 swap.** Kept because the way it hid is worth
more than the bug.

`o1 + a[1]` read a type-confused pointer. On native 1.27 the process dies
silently; **in RingScript it was worse** — `eval()` returned `ok: true` with
no output and no error, so a program that produced nothing looked like a
program that succeeded:

```
output   : ""
ok       : true
error    : (none)
VM alive : true
```

The shipped sample `samples/ProblemSolving/Lists/arrayvector2.ring` was
affected. Objects in plain variables were fine, and a list element as the
*left* operand was fine; only the right-operand path was broken.

Reported as [ring-lang/ring#1647](https://github.com/ring-lang/ring/pull/1647)
and fixed by Mahmoud in
[3482b57](https://github.com/ring-lang/ring/commit/3482b57) (revise
`ring_vm_oop_operatoroverloading2()`) and
[05dc3f4](https://github.com/ring-lang/ring/commit/05dc3f4) (use
`ring_vm_pushv()` rather than `ring_vm_varpushv()`, which is designed for
*variables* and not for *items* — the distinction the first attempt at a
fix missed).

**What it cost us to learn:** our sweep had been dropping this sample. A
native failure meant "the oracle could not run it", so the program was
excluded from comparison rather than flagged — and a VM bug bad enough to
kill the interpreter lands in exactly that bucket. `samples-sweep.js` now
records native failures in `sweep-failures.json` by name instead of only
counting them.
