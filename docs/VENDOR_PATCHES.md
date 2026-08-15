# Vendor patches to ringvm/

`ringvm/` is the vendored Ring VM source (currently **1.27**, from
the official 1.27 distribution). It carries seven live RingScript patches, each marked with a
`RINGSCRIPT PATCH` comment at the site. **Any future vendor swap must
re-apply them** — then run `zig build` and `node tests/gates.js` (the P2
line-number gates fail if the eval patches are missing).

An eighth was carried and then withdrawn; see section 8 for why, and for
what replaced it.

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

## 3. `ringvm/src/stmt.c` — fix `private` inside eval (upstream crash)

In the `K_PRIVATE` handler, `pParser->nClassMark` (from `newlabel2`) is a
GLOBAL instruction number (`pGenCode size + nInstructionsCount`), but
`ring_parser_icg_getoperationlist` indexes the LOCAL `pGenCode` list. With
any prior code in the state the raw index reads far past the list. This
crashes **stock native Ring 1.27** too — `eval("class q private b = 2")`
kills ring.exe — and since the resident bridge routes everything through
eval, every class with a `private` section crashed the wasm instance.
The patch subtracts `nInstructionsCount` at the lookup. Worth reporting
upstream (a real crash bug, unlike the global/attribute scope rule).

## 4. `ringvm/src/vmexpr.c` — strtod errno portability (musl vs MSVC)

In `ring_vm_stringtonum`, the error branch fires when `strtod` returned 0
with `errno` set. On no-conversion input, musl (wasi-libc) sets `errno`
to EINVAL while MSVC/glibc leave it untouched — so `"test" = 5` raised
`R41 Invalid numeric string` under wasm where native prints `0` (false).
The patch adds a `cEndStr != cStr` guard so plain no-conversion falls to
the existing no-conversion branch. Portability fix, worth upstreaming
(bites any musl-based Ring build, not just wasm).

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

## 7. `ringvm/src/rlist.c` — `sort(list, nColumn)` was O(n²)

`ring_list_sortnum_gc` / `ring_list_sortstr_gc` extract keys, quicksort an
index array, then rebuild the list by reading `pList` at `idx[i]` — in
sorted order, which is to say randomly. Without the items array,
`ring_list_getitem` walks the linked list, so the rebuild is quadratic.

Measured on stock Ring, sorting `[key, index]` pairs: **2.3 / 8 / 39 /
257 ms** at 2.5k / 5k / 10k / 20k rows — quadrupling per doubling — while
sorting the same values as a flat list stayed linearithmic (0.4 / 0.6 /
1.3 / 4.0 ms). The patch calls `ring_list_genarray_gc()` before the
rebuild when `nColumn != 0`. After it: **0.9 / 2.1 / 6.0 / 16.4 ms**.
Sorting rows by a column is what every data table does; worth upstreaming.

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

# Upstream fixes to pick up at the next vendor swap

Bugs fixed in Ring after 1.27 that the vendored tree here still has. These
are **not** patches to re-apply — they arrive for free with a newer Ring —
but they are worth knowing about while we are still on 1.27.

## Operator overloading with a list element as the right operand

`o1 + a[1]` reads a type-confused pointer. On native 1.27 the process dies
silently; **in RingScript it is worse** — `eval()` returns `ok: true` with
no output and no error, so a program that produces nothing looks like a
program that succeeded:

```
output   : ""
ok       : true
error    : (none)
VM alive : true
```

The shipped sample `samples/ProblemSolving/Lists/arrayvector2.ring` is
affected. Objects in plain variables are fine, and a list element as the
*left* operand is fine; only the right-operand path is broken.

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
