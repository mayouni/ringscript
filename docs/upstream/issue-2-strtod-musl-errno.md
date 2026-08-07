# TITLE: Portability: string/number comparison raises R41 on musl-based builds (strtod errno differs from MSVC/glibc)

<!-- ready to paste as a ring-lang/ring ISSUE — everything below this line -->

**Ring 1.27.0. Affects any musl-libc build: WASI/WebAssembly, Alpine
Linux, some embedded toolchains. MSVC and glibc builds are unaffected.**

## Reproduction

```ring
if "test" = 5 see "equal" else see "not equal" ok
```

- MSVC / glibc build: prints `not equal` (verified on Windows 1.27.0)
- musl build: raises `Error (R41) : Invalid numeric string`

## Cause

In `ring_vm_stringtonum` (`vmexpr.c`) the error branch fires when
`strtod` returned 0 with `errno` set:

```c
if (nResult == 0 && (errno != 0)) {
```

C leaves `errno` **unspecified** for strtod's no-conversion case:
MSVC and glibc leave it untouched, musl sets `EINVAL`. So on musl,
converting a plain non-numeric string ("test") takes the error branch
instead of falling through to the existing no-conversion handling
below it.

## Fix (one guard)

No conversion means `cEndStr == cStr`, which distinguishes the case
portably:

```c
if (nResult == 0 && (errno != 0) && (cEndStr != cStr)) {
```

The genuine error cases (ERANGE underflow etc.) still take the branch —
they consumed characters, so `cEndStr != cStr` holds for them.

This has been running in RingScript (the Ring 1.27 VM compiled to
WebAssembly against musl-based wasi-libc,
https://github.com/mayouni/ringscript), where without it every
string-vs-number comparison misfired; with it, ~850 programs run
byte-identical to native ring.exe. Happy to open a PR if you'd like
it as one.
