**Title:** Comparing a non-numeric string to a number raises R41 on musl builds (Alpine, WASI)

**Labels:** bug, portability

**Kind:** issue (a PR with the one-line fix can follow)

---

## Summary

On any Ring built against **musl** libc — Alpine Linux, or a
wasm32-wasi build via wasi-libc — comparing a plain non-numeric string
to a number raises `Error (R41): Invalid numeric string` instead of
evaluating false.

## Reproduction

```ring
if "test" = 5 see "equal" else see "not equal" ok
see nl
```

**On Windows/MSVC and Linux/glibc** (verified on Ring 1.27.0, Windows):

```
not equal
```

**On musl:**

```
Error (R41) : Invalid numeric string
```

## Cause

`ring_vm_stringtonum()` in `ringvm/src/vmexpr.c` decides an error
occurred when `strtod` returned 0 **and** `errno` is set:

```c
nResult = strtod(cStr, &cEndStr);
if (nResult == 0 && (errno != 0)) {
    if (errno == ERANGE) {
        ring_vm_error(pVM, RING_VM_ERROR_NUMERICUNDERFLOW);
    } else {
        ring_vm_error(pVM, RING_VM_ERROR_NUMERICINVALID);
    }
    return RING_ZEROF;
}
```

C99 only requires `errno` to be set for **range** errors. For a
*no-conversion* input like `"test"`, whether `errno` is touched is
implementation-defined:

- MSVC and glibc leave it alone → the code falls through to the
  existing no-conversion branch (`cStr == cEndStr`), which is the
  correct path;
- musl sets `EINVAL` → the error branch fires first, and a
  perfectly ordinary comparison raises.

The function already has proper handling for no-conversion a few lines
below; it simply never gets reached on musl.

## Suggested fix

Only treat a set `errno` as an error when a conversion actually
happened:

```c
if (nResult == 0 && (errno != 0) && (cEndStr != cStr)) {
```

Genuine underflow (`ERANGE` with characters consumed) still reports;
no-conversion falls through to the branch written for it.

## Why it matters beyond wasm

Alpine-based Docker images are a common way to ship small Ring
containers, and everything there is musl. The symptom is subtle — a
comparison that should be false raises instead — so it is easy to
mistake for a program bug rather than a platform difference.

## Verification

This fix has been running since 2026 in a wasm32-wasi build of the Ring
1.27 VM held byte-exact against native `ring.exe` across roughly 850
programs (Ring's `samples/` corpus plus every runnable documentation
snippet), with zero output differences. Happy to open it as a PR.
