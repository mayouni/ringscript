# Name folding: four functions, one root cause

**Status: SENT** — posted to the [#1645 thread]
(https://github.com/ring-lang/ring/pull/1645#issuecomment-5290940185) on
2026-08-14, on Mansour's explicit instruction.

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
