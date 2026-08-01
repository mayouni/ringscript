# Vendor patches to language/

`language/` is the vendored Ring VM source (currently **1.27**, from
`D:\ring127`). It carries two deliberate RingScript patches, both marked
with `RINGSCRIPT PATCH` comments at the site. **Any future vendor swap
must re-apply them** — then run `zig build -Drelease=true` and
`node tests/gates.js` (the P2 line-number gates fail if either patch is
missing).

## 1. `language/src/vmeval.c` — keep line numbers in eval'd bytecode

Upstream wraps the eval parser call in `lNoLineNumber = 1 … = 0`, which
strips `ICO_NEWLINE` instructions from eval'd code. The bridge runs all
user code through `eval()` (the try/catch shim in `bridge.zig`), so that
would freeze `pVM->nLineNumber` at the try-entry line. The patch removes
the forcing so the state's flag (default 0) is respected.

## 2. `language/src/vmerror.c` — capture the failing line at error time

Adds a global `unsigned int rs_error_line` set from `pVM->nLineNumber`
at the top of `ring_vm_error()` (after the active-error guard). Needed
because `ring_vm_catch → ring_vm_restorestate` rewinds the VM's line
number to its try-time value *before* the catch block runs — by the time
`rs_reporterror` fires, the line is gone from the VM. The bridge reads
`rs_error_line` via `extern var` (bridge.zig).

Together these make `rs_last_error()` report the real failing line for
multi-line evals (e.g. an error on line 3 reports `line 3: …`).
