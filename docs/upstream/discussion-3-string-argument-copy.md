**Title:** Every string argument is copied onto the VM stack — `len()` on a 1 MB string is 5,000× slower than on a 10-byte one

**Labels:** performance, discussion

**Kind:** discussion — this is a design question, not a patch request

---

## Summary

Passing a string variable to a function copies the entire string onto
the VM stack. Because of that, any Ring code that touches a large string
repeatedly is O(length) per touch and O(n²) overall — even when the
function does no work proportional to the length at all.

## Reproduction

Both loops do exactly the same amount of *work* — 20,000 calls to
`len()`, which just reads a stored size. Only the size of the argument
differs.

```ring
cTiny = "0123456789"
cBig = "a"
while len(cBig) < 1048576 cBig += cBig end

t1 = clock()
nS = 0
for i = 1 to 20000 nS += len(cTiny) next
t2 = clock()
nS2 = 0
for i = 1 to 20000 nS2 += len(cBig) next
t3 = clock()
see "len(10 B)  x 20k : " + ((t2-t1)/clockspersecond()*1000) + " ms" + nl
see "len(1 MB)  x 20k : " + ((t3-t2)/clockspersecond()*1000) + " ms" + nl
```

Measured on stock Ring 1.27.0, Windows (one run; four repeats gave
4,885–5,006 ms for the second line, 1 ms for the first):

```
len(10 B)  x 20k : 1 ms
len(1 MB)  x 20k : 5006 ms
```

**Roughly 5,000×.** About 20 GB was memcpy'd to answer 20,000 length
queries.

## Cause

`RING_VM_STACK_PUSHCVAR` in `ringvm/include/vm.h`:

```c
#define RING_VM_STACK_PUSHCVAR \
    ring_itemarray_setstring2_gc(pVM->pRingState, pVM->aStack, pVM->nSP, \
                                 ring_list_getstring(pVar, RING_VAR_VALUE), \
                                 ring_list_getstringsize(pVar, RING_VAR_VALUE))
```

The value is copied, not referenced. This is also what gives Ring its
clean value semantics, so it is not a bug — but the cost is invisible
from Ring, and it sets a ceiling on what any string-heavy Ring library
can achieve.

## Practical impact

Anything that scans a large string in Ring inherits the quadratic:
parsers, tokenizers, template engines, CSV/JSON codecs, text
processing.

A concrete data point: a JSON decoder written in pure Ring decodes at
about **0.27 MB/s**, while the equivalent decoder written in pure Lua
manages **7.5 MB/s** on the same machine — a 28× gap. Part of that is
Lua's C string primitives, but the *quadratic* component is entirely
this copy: the Ring decoder cannot look at byte *i* of the payload
without the payload being copied.

## Possible directions

Offered as data for a decision — each has a different semantic cost,
and the trade-off is genuinely yours to make:

1. **Borrowed arguments for read-only builtins.**
   `len()`, `ascii()`, `left()`, `right()`, `substr()` (the source
   argument), `find()` never mutate or retain their string argument. A
   flag at C-function registration — "does not retain or mutate" —
   could let `PUSHCVAR` push a pointer for exactly those calls. This is
   the smallest change with the largest share of the benefit, and it
   leaves user-defined functions untouched.

2. **Copy-on-write strings.** Reference-count the buffer and copy only
   when a writer appears. Benefits everything, including user
   functions, but needs care with the GC and with `ring_string_*`
   mutation sites.

3. **Reuse the existing substring machinery.** `RING_OBJTYPE_SUBSTRING`
   suggests the VM already has vocabulary for "a view into a string";
   perhaps it can carry more of this weight.

## Context

Found while building a WebAssembly runtime on the Ring 1.27 VM, but the
measurement above is stock native `ring.exe` on Windows — nothing about
this is wasm-specific. That project worked around it by moving its JSON
codec into C, but every pure-Ring program on every platform still pays
it.

Happy to contribute benchmarks, a test corpus, or prototype work if any
of these directions is of interest.
