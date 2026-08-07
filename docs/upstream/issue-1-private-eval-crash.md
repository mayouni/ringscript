# TITLE: Crash: eval("class q private b = 2") kills ring.exe (K_PRIVATE indexes pGenCode with a global instruction number)

<!-- ready to paste as a ring-lang/ring ISSUE — everything below this line -->

**Ring 1.27.0, Windows (also reproduced in a WASI build of the same source).**

## Reproduction

```ring
eval("class q private b = 2")
see "survived" + nl
```

The process dies before printing anything — exit code 1, no error
message. The same class definition works fine when it is written in the
file directly.

The trigger is not `eval()` itself but **any code compiled into the
state before the class**: the crash needs `nInstructionsCount` to be
non-zero when the `private` section is parsed. An embedded or resident
use of `ring_state_runcode()` hits the same crash without `eval()`.

## Cause

In the `K_PRIVATE` handler in `stmt.c`, `pParser->nClassMark` (recorded
by `ring_parser_icg_newlabel2()`) is a **global** instruction number —
`pGenCode size + nInstructionsCount` — but it is passed to
`ring_parser_icg_getoperationlist()`, which indexes the **local**
`pGenCode` list:

```c
pList = ring_parser_icg_getoperationlist(pParser, pParser->nClassMark);
```

When `nInstructionsCount == 0` (a plain file compiled from scratch) the
two numbering schemes coincide and everything works. With any
previously compiled code the raw index reads far past the list.

## Fix (one line)

```c
pList = ring_parser_icg_getoperationlist(
    pParser, pParser->nClassMark - pParser->pRingState->nInstructionsCount);
```

This has been running in RingScript (the Ring 1.27 VM compiled to
WebAssembly, https://github.com/mayouni/ringscript) since August 2026,
where every class arrives through the eval path — it is exercised by
that project's full test battery (~850 programs byte-identical to
native ring.exe). Happy to open a PR if you'd like it as one.
