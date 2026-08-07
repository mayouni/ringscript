**Title:** `eval()` of a class with a `private` section crashes ring.exe

**Labels:** bug, crash

**Kind:** issue (a PR with the one-line fix can follow)

> **ALREADY DELIVERED — do not refile.** This went upstream as PR
> [#1639](https://github.com/ring-lang/ring/pull/1639) (with the other
> one-line fix), closed August 2, 2026 with *"Thanks for the bug report /
> I will revise/fix them using PWCT in the future"*. Also note
> `ring-lang/ring` has issues disabled — there is no tracker to file
> this on. Kept as the written-up version of the finding.

---

## Summary

Defining a class that has a `private` section through `eval()` terminates
the process immediately — no output, no error message, exit code 1.

## Reproduction

Ring 1.27.0, Windows (also reproduces anywhere code is compiled into the
state before the class):

```ring
eval("class q private b = 2")
see "survived" + nl
```

**Expected:** `survived`

**Actual:** the process dies before printing anything. Exit code 1, and
nothing on stdout or stderr.

The same class works when written directly in the file — the crash needs
the class definition to arrive *after* other code has already been
compiled into the state. `eval()` is the easy way to reach that, but any
embedded or long-running host that compiles more than once will hit it
routinely.

## Cause

In `ring_parser_stmt()`'s `K_PRIVATE` handler (`ringvm/src/stmt.c`):

```c
pList = ring_parser_icg_getoperationlist(pParser, pParser->nClassMark);
```

`pParser->nClassMark` is set by `ring_parser_icg_newlabel2()`, which
returns a **global** instruction number — `pGenCode` size **plus**
`pRingState->nInstructionsCount`. But
`ring_parser_icg_getoperationlist()` indexes the **local** `pGenCode`
list.

When `nInstructionsCount` is 0 — a plain script compiled from scratch —
the two numbers coincide and everything works, which is why this has
stayed hidden. With any previously compiled code in the state, the index
is too large by exactly `nInstructionsCount` and the read runs past the
end of the list.

## Suggested fix

Subtract the offset at the lookup:

```c
pList = ring_parser_icg_getoperationlist(
    pParser, pParser->nClassMark - pParser->pRingState->nInstructionsCount);
```

## Verification

This fix has been running since August 2026 in a build of the Ring 1.27
VM that is held byte-exact against native `ring.exe` across roughly 850
programs — Ring's own `samples/` corpus plus every runnable code block in
the documentation — with zero output differences. Happy to open it as a
PR if the shape looks right.
