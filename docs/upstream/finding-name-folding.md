# Name folding: four functions, one root cause

**Status: SENT, and the PR now carries the fix.** Reply posted to the
[#1645 thread]
(https://github.com/ring-lang/ring/pull/1645#issuecomment-5290940185) on
2026-08-14, on Mansour's explicit instruction.

On 2026-08-14 the PR was re-scoped from one function to four:
[namefolding.ring](../../tests/upstream/namefolding.ring) replaces the
narrower test, the patch moved from copy-and-fold to `ring_general_lower()`
in place to match `meta_e.c`, and the description carries the sweep and the
cost table. Youssef is `@ysdragon` on GitHub.

Youssef commented on [#1645](https://github.com/ring-lang/ring/pull/1645)
that `varptr` has the same problem. He is right, and there is more of it
than either of us said.

## What Youssef reported

```ring
r = 10
z = 20
? r
? varptr("R","int")
```

```
10

Line 4 Error (R6) : Variable is required
In varptr()
```

**Reproduces exactly on stock Ring 1.27** (`D:\ring127\bin\ring.exe`).

## The root cause, at the source

The compiler folds identifiers to lower case when it stores them. Every
function that takes a variable name *as a string* then looks it up with an
exact match, so a caller who spells the name the way their own source spells
it misses:

- `varptr` → `ring_vm_api_varptr()` (`language/src/ringapi.c:236`) →
  `ring_vm_findvar()` → `ring_vm_findvarusinghashtable()` — exact key
- `ring_state_findvar` → the same shape in `language/src/genlib_e.c:1561`

Neither folds. That is one cause, and #1645 currently addresses one of its
symptoms.

## The whole family, measured

One variable, spelled two ways, on Ring 1.27:

| call | lower-case name | name as written in source |
|---|---|---|
| `varptr("nTotal","int")` | works | **R6 error** — "Variable is required" |
| `ring_state_findvar(st,"nCount")` | works | **returns `0`** — silent miss |
| `ring_state_setvar(st,"nCount",v)` | works | **R6 error** |
| `ring_state_newvar(st,"cRegion")` | works | **creates an unreachable variable** |

So Youssef found a second, and there are four. Two fail loudly, one fails
silently, and one is worse than either.

### The `newvar` case is the interesting one

`ring_state_newvar(st,"cRegion")` stores the name **unfolded**:

```
findvar 'cRegion' -> FOUND
findvar 'cregion' -> NOT FOUND
```

and Ring code running inside that state — which folds to `cregion` — gets
`R24: Using uninitialized variable: cregion`. The variable exists and no
Ring source in that state can address it.

## What this means for #1645 itself

**Folding inside `ring_state_findvar()` alone would regress a pair that
works today.** `newvar("cRegion")` then `findvar("cRegion")` currently
matches, because both are unfolded and the comparison is exact. Fold only
the reader and it searches `cregion` against a stored `cRegion` — and the
one path that works becomes a miss.

This follows from the two measurements above rather than from a build: the
stored key is literally `cRegion` (else `findvar("cRegion")` could not find
it), and the lookup is exact (else `findvar("nCount")` would have found
`ncount`).

The fix has to be the whole family or none of it — fold at the boundary in
all four, so the stored key is always folded and every lookup folds too.
Which is the same lesson as the accessor change on
[#1642](https://github.com/ring-lang/ring/pull/1642): the narrow patch
solves the stated problem and moves the damage somewhere the test that
motivated it never looks.

## Reproduction

[`tests/upstream/namefold.ring`](../../tests/upstream/namefold.ring)

```bash
ring tests/upstream/namefold.ring
```

Note on step 4 of that file: after the fix, `findvar` finds both spellings
but the `R24` line stays, because `newvar` creates the variable without
assigning it. That last line is an uninitialized variable, not a folding
failure — [`e2e`](#the-fix-measured) below is the honest end-to-end check.

---

# The fix, measured

[`namefold.patch`](namefold.patch) — four call sites in `genlib_e.c`, using
`ring_general_lower()`, which is Ring's own folder and the one the scanner
uses at `scanner.c:237`.

**It is Mahmoud's existing idiom, not a new one.** `meta_e.c` already does
`cStr = ring_general_lower(RING_API_GETSTRING(1))` in five places —
`islocal`, `isglobal`, `isfunction`, `isattribute`, `ismethod`. Those
functions have always been case-insensitive. The patch makes the other four
behave like them.

Folding in place does **not** mutate the caller's variable — arguments are
copied to the stack. Verified: `cName = "nTotal"` is still `nTotal` after
`islocal(cName)` on a stock build.

## Method

Two native builds from `D:\ring127\language\src`, identical but for that
patch, `zig cc -O2` (zig 0.15.2). The stock build is **byte-identical in
output to the shipped `ring.exe`** on the reproduction, so the baseline is
the real thing.

## Correctness

| | stock | patched |
|---|---|---|
| `varptr("nTotal","int")` | R6 error | **ok** |
| `ring_state_findvar(st,"nCount")` | NOT FOUND | **found** |
| `ring_state_setvar(st,"nCount",v)` | R6 error | **ok** |
| `ring_state_newvar` + `setvar` + read as `cRegion`/`cregion`/`CREGION` | R24, empty | **`Tillaberi` all three** |

## Regression sweep

All **978** programs under `language/tests/` through both builds, output
compared byte for byte:

| | |
|---|---:|
| identical | **966** |
| different | 12 |

Every one of the 12 accounted for, none attributable to the patch:

- **8** are timing tests under `performance/` and the `usestyle*` pair —
  nondeterministic against *stock alone* across repeat runs
- **`math.ring`** — differs only in its `Time :` line
- **`p8.ring`** — an interactive menu reading `give`, fed `/dev/null`
- **`program2.ring`, `testsyntax1/2.ring`, `usestylebasic.ring`** — these
  need `bin/load/natural/` and `libraries/naturallib/`, which **do not
  exist in the 1.27 install**; the shipped `ring.exe` fails them too. None
  of them, or anything they load, calls any of the four patched functions,
  and each produces two or three *different* outputs across repeat runs of
  the same binary

## Cost

The fold is `strlen` plus a per-character `isalpha`/`tolower`, so it is
O(name length). Interleaved runs, minimum of six:

| `varptr` name | calls | stock | patched | per call |
|---|---:|---:|---:|---:|
| 6 chars (`ntotal`) | 1,500,000 | 1,429 ms | 1,411 ms | **below noise** |
| 121 chars | 300,000 | 357 ms | 484 ms | **+423 ns** (+35.6%) |

At 6 characters the two distributions overlap completely — stock
[1429…1510], patched [1411…1448] — so the cost is not measurable at 1.5M
calls. At 121 characters they do not overlap at all — stock [357…369],
patched [484…702] — which is about **3.5 ns per character**, exactly as the
mechanism predicts.

Real variable names are short, so the practical cost is nil. `ring_state_findvar`
with a 6-character name likewise shows no measurable change.

## Why this is not the #1642 mistake again

The accessor change on #1642 was rejected because its cost landed on
**every free in the program**, including programs that never triggered the
thing it optimised. This one is confined to four functions: a program that
does not call them pays exactly nothing, because the added instructions are
not on any other path.

That is the test Mahmoud's objection really sets — not "is it faster here"
but "who else pays" — and here the answer is nobody.

## A cheaper variant, if the cost ever mattered

Try the name as given and fold only on a miss, so callers already passing
folded names do no extra work:

```c
pList = ring_state_findvar(pRingState, RING_API_GETSTRING(2));
if (pList == NULL) {
    pList = ring_state_findvar(pRingState, ring_general_lower(RING_API_GETSTRING(2)));
}
```

Built and measured as a third binary; at realistic name lengths it is
indistinguishable from both the others, so it buys nothing today. Worth
knowing it exists, not worth the extra branch. `newvar` must fold
unconditionally either way, since it is writing the key.

---

## The reply, as posted

Sent with the four-row table, the `newvar` consequence, and the full
reproduction inline. What follows is the substance of it.

> Thank you Youssef — you are right, and it is wider than I had it.
>
> `varptr` reproduces exactly as you show on 1.27. Going after it I found
> the same root cause in two more places, so it is four rather than two:
>
> - `varptr("nTotal","int")` — R6, as you found
> - `ring_state_findvar(st,"nCount")` — returns 0, silently
> - `ring_state_setvar(st,"nCount",v)` — R6
> - `ring_state_newvar(st,"cRegion")` — no error, but it stores the name
>   unfolded, and then Ring code inside that state gets R24 for `cRegion`.
>   The variable exists and nothing in that state can reach it.
>
> All of them are the same thing: the compiler folds identifiers when it
> stores them, and these lookups compare exactly.
>
> That last one changes what I proposed here. `newvar("cRegion")` followed
> by `findvar("cRegion")` matches today precisely because both are
> unfolded. If I fold only the reader, as this patch does, that pair stops
> working — I would be fixing one spelling and breaking another.
>
> So I think the patch as it stands is wrong, and I would rather withdraw
> it than have it land. If it is worth doing at all it wants folding at the
> boundary in all four, so the stored name is always folded and every
> lookup folds too. Mahmoud, that is a question for you rather than a
> proposal from me — it touches how names are stored.
>
> Mansour
