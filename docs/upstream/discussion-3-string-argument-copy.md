# TITLE: Discussion: every string argument is copied onto the VM stack — 20k len() calls on a 1 MB string cost 5 seconds

<!-- ready to paste as a ring-lang/ring DISCUSSION (or issue) -->

**Ring 1.27.0, Windows, stock ring.exe. This is a measurement and a
question about direction, not a patch — the current behavior is also
what gives Ring its clean value semantics, so the trade-off is a
design decision.**

## The measurement

`len()` does the same O(1) work in both loops below; only the size of
the argument differs:

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

Measured on stock native 1.27.0:

```
len(10 B)  x 20k : 1 ms
len(1 MB)  x 20k : 5006 ms
```

**5,000× for identical work** — about twenty gigabytes memcpy'd to
answer twenty thousand length queries.

## Where it comes from

`RING_VM_STACK_PUSHCVAR` in `vm.h` copies the full string value onto
the VM stack whenever a string variable is used as an argument:

```c
#define RING_VM_STACK_PUSHCVAR \
    ring_itemarray_setstring2_gc(pVM->pRingState, pVM->aStack, pVM->nSP, \
                                 ring_list_getstring(pVar, RING_VAR_VALUE), \
                                 ring_list_getstringsize(pVar, RING_VAR_VALUE))
```

The consequence is that any Ring program touching a large string
repeatedly — a parser, a codec, a text processor — is O(len) per touch
and O(n²) overall. Concretely: a pure-Ring JSON decoder we wrote
measures ~0.27 MB/s, while Lua's pure-Lua equivalent (json.lua) does
~7.5 MB/s on the same machine. Part of that gap is Lua's C string
primitives, but the *quadratic* component is entirely this copy.

## Possible directions, in rising ambition

1. **Borrowed arguments for read-only builtins.** `len()`, `ascii()`,
   `substr()`'s source argument, `left/right/copy/find` never mutate or
   retain their string argument. A flag on C-function registration
   ("does not retain or mutate") could let the push hand over a
   pointer for exactly those calls. Smallest semantic surface; covers
   the hottest cases.
2. **Copy-on-write strings** — reference-count the buffer, copy only
   when a writer appears. Larger change, benefits everything, needs
   care around the GC.
3. The existing **`RING_OBJTYPE_SUBSTRING`** machinery already gives
   the VM a vocabulary for "a view into a string" — maybe it can carry
   more of this weight.

I'm happy to contribute benchmarks, test programs, or prototype work
for any direction you consider right for Ring. The measurement above
came out of RingScript (https://github.com/mayouni/ringscript), where
this showed up as the bottleneck under a JSON codec — but every
pure-Ring program on every platform pays it, which is why I'm raising
it here rather than only working around it.
