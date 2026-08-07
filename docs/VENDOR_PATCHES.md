# Vendor patches to ringvm/

`ringvm/` is the vendored Ring VM source (currently **1.27**, from
the official 1.27 distribution). It carries two deliberate RingScript patches, both marked
with `RINGSCRIPT PATCH` comments at the site. **Any future vendor swap
must re-apply them** — then run `zig build -Drelease=true` and
`node tests/gates.js` (the P2 line-number gates fail if either patch is
missing).

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
