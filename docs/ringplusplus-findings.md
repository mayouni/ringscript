# Ring++ — what the sources actually say

Stage one of [the kickoff prompt](ringplusplus-kickoff.md): read the three
sources and report the surprises **before** any design. No design here.

Read against pristine Ring 1.27 at `D:\ring127\language\src`, not the
RingScript vendored copy, so that our own patches are never mistaken for
Mahmoud's design.

---

## 1. The one that changes the plan

The obvious Ring++ pitch is *give Ring programmers real memory*: buffers,
pointers, pre-sized arrays. I went looking for the evidence and found the
opposite.

Ring already has a fast path for building a list in bulk —
`ring_vm_api_newlistusingblocks()`, two contiguous `calloc`s instead of N
pool allocations — and `list(n)` already uses it above 30 items
(`list_e.c:187`). So `list(n)` and append-in-a-loop are structurally
different allocations. They are **the same speed**:

| 300,000 items | |
|---|---:|
| `a + i` in a loop | 21 ms |
| `list(n)` then `b[i] = i` | 21 ms |

Because allocation is not what the time is going on:

| 300,000 iterations | | per iteration |
|---|---:|---:|
| empty `for` loop | 5 ms | ~17 ns |
| loop + one assignment | 14 ms | ~47 ns |
| loop + one append | 23 ms | ~77 ns |

**The interpreter loop is the floor, and it is most of the cost.** An empty
loop already spends 17 ns an iteration; the append that allocates two pool
objects adds ~30 ns on top of an assignment. Allocation is cheap because the
pool is good.

So the lever is not better memory. It is **not executing the Ring loop at
all**. A bulk operation that does the same work in C runs at 1–2 ns an item;
the win is 10–30×, and every bit of it comes from deleting iterations, not
from smarter allocation.

This also explains the one big win we already measured. `ringvm_genarray()`
took a permuted read of 80,000 items from 962 ms to 20.6 ms not because it
allocated better, but because it removed an O(n²) walk. **Ring++ should be a
catalogue of removed work, not a pointer library.**

That reframes the whole thing, and it is the opposite of what I expected to
write.

## 2. The memory pool is a one-shot arena

`ring_poolmanager_allocate()` calls `ring_poolmanager_newblock()` exactly
once per state — the guard is `pCurrentItem == NULL && pBlockStart == NULL`,
and `newblock` sets `pBlockStart`. It never runs a second time.

Three size classes, and one block each, for the life of the state:

| level | item size | items in block |
|---|---:|---:|
| 1 | 48 B | 100,000 |
| 2 | 256 B | 4,096 |
| 3 | 512 B | 2,048 |

Consequences, none of them documented:

- **Anything over 512 bytes is never pooled.** It goes to `ring_malloc`, and
  its free takes the slow path.
- **When a level's free list runs out, that level is done forever.** Every
  later allocation of that size falls to `ring_malloc`. A long-running
  program silently leaves the fast path and does not come back.

For Ring++ this is a hard design rule: allocate **few and large, once**, or
**small and pooled**. The shape that hurts is many medium-lived allocations
in the 512 B–megabyte range.

## 3. What `ring_state_free()` really costs — and a correction

The slow path is:

1. `ring_poolmanager_find()` — three pointer-range compares, O(1);
2. on a miss, lock `vPoolManager.pMutex` and **walk `vPoolManager.pBlocks`**,
   testing the pointer against each registered `[start, end]`;
3. if it falls in a registered block, return **without freeing**.

Two things worth having straight:

- The mutex is a null check unless threads are in use —
  `ring_vm_custmutexlock()` returns immediately when `pMutex == NULL`, and
  `poolmanager_new()` sets it to `NULL`. Single-threaded programs pay
  nothing for it.
- **Correction to how I recorded Mahmoud's objection on #1642.** I wrote
  that the pool "checks on every free whether the pointer belongs to an
  array created this way". It does not: `ring_list_genarray_gc()` allocates
  with `ring_state_malloc` and never registers the array, so it is not in
  `pBlocks`. What the walk actually contains is blocks handed over by
  `ring_state_registerblock()`.

  His *conclusion* was right and the A/B confirmed it — 1.7–2.3× slower on
  mixed add/read. But the dominant mechanism is not the free path. It is
  that `ring_list_clearcache_gc()` frees the items array on every structural
  mutation while a random read rebuilds it, so an add/read alternation pays
  a `malloc` plus a **full O(n) rebuild per iteration**. That is a much
  bigger effect than a handful of range compares, and it matters for Ring++
  because it says: any cache Ring++ builds over a list must survive
  mutation, or be explicitly rebuilt by the programmer rather than
  implicitly by an accessor.

## 4. `ring_state_registerblock()` — the sanctioned way in, with a global price

A public API for handing Ring a contiguous foreign range and telling the
collector not to free inside it. Used by `ring_vm_api_newlistusingblocks()`
and by RingQt's bundled VM.

The price is global: every non-pool free walks the registered list. So the
rule for Ring++ is **few, large, long-lived registrations** — one arena, not
one per object. Registering per-buffer would tax every free in the program,
which is exactly the failure mode Mahmoud rejected on #1642.

## 5. Lists are already hash maps when they want to be

`List` carries `pHashTable`, `pHashParent`, `nIsHashMap`, `nHashSubList`
alongside the linked items and the cursor. The structure for O(1) keyed
lookup is present in every list. How much of it is reachable from Ring, and
at what cost, is the open question I have not answered yet.

---

## 6. myctiger says Mahmoud already considered this shape — and passed on it

His README is explicit, and it is about exactly our territory:

> *Unlike traditional approaches that embed Ring within C applications or
> extend the Ring VM using C code, MyCTiger reimagines Ring as a
> meta-language for C. This isn't about runtime language integration—it's
> about compile-time code generation.*

So the two approaches Ring++ would naturally take — embed, or extend the VM
— are named there as the alternatives he set aside. That is not a veto, but
it is the single most important thing to have read before proposing a
runtime library to him, and it should be answered directly rather than
ignored.

What it does **not** do is satisfy the brief. Tiger is a separate toolchain:
you write `.tiger`, you get `.c` and `.exe`, you have left Ring. There is no
"start in normal Ring and drop a level in the same file". It is Ring 1.24,
Windows, bundled TCC, self-described prototype, two months of commits,
untouched since December 2025.

My reading: the *goal* is shared, the *shape* is not — and the reason it
stopped may be that generating C makes the drop-down a build step rather
than an expression. Ring++ living inside the running VM keeps it an
expression. I hold that loosely until the group thread is read.

## 7. Softanza already solved the layering question

The System module is ~11,000 lines about pointers, memory, processes and
virtual systems. Grepped for Ring's low-level primitives across all 24
files: **zero matches.**

They all live one layer down, in the CORE — `stkPointer.ring` uses `varptr`,
`getptr`/`setptr`, `obj2ptr`/`ptr2obj`, `ptr2str`, `nullptr` — and the `stz`
sugar layer is a thin wrapper:

```ring
func StzPointerQ(pParams)
    return new stkPointer(pParams)

class stzPointer from stkPointer
```

That is the discipline to inherit, and it is already proven in your own
code: **unsafe primitives confined to a core layer with a name that warns,
sugar layer never touches them.** It also answers the independence question
in the prompt — Ring++ wants the same two-layer split, and can be a peer of
`stk*` rather than a layer inside Softanza.

## 8. The safety story is already written — by you

A background search turned up
`base/doc/references/softanza-memory-framework-redesign.md`, and the code it
describes exists: **2,018 lines** across `stkMemory.ring` (387),
`stkBuffer.ring` (871) and `stkPointer.ring` (760).

It is a borrow model expressed in Ring:

```
stkMemory (container)
└── stkBuffer (owned, never orphaned)
    ├── stkPointer (read)   — many allowed
    └── stkPointer (write)  — exactly one
```

with views (`CreatePointerView(id, "read", 0, 64)`), automatic invalidation
when a buffer dies, and no buffer able to exist outside a container.

Two things follow.

**Ring++ should not invent a safety model.** Item 4 of the kickoff prompt
asks for one; the answer is to adopt this, not design a rival.

**It converges with finding 4 by accident, and that is the interesting
part.** The VM says registrations with `ring_state_registerblock()` must be
few, large and long-lived, because every non-pool free walks the list. The
Softanza design says every buffer must be owned by exactly one `stkMemory`.
Those are the same constraint reached from opposite directions — **one
`stkMemory` is one arena is one registration.** The ownership rule that
exists for safety is also the rule that keeps the VM fast.

The layering is sharper than I reported in finding 7, too. It is three
tiers, not two: `stkMemory` is pure bookkeeping and touches **no**
primitives at all; they are concentrated in `stkPointer`. Ownership,
storage, and raw access are separated, and only the innermost one is
dangerous.

---

## The thesis, proven before designing on it

The claim above — that moving a loop into C is worth 10–30× — was a
prediction from the per-iteration floor, so I measured it rather than
designing around it.

The fairest test available uses Ring's own machinery: `find(aList, value)`
scans the list in C; the identical scan written in Ring does the same work
on the same list. Worst case chosen deliberately (the target is the last
item), so both traverse everything. 200,000 items, 50 repetitions, three
runs:

| | per scan | per item |
|---|---:|---:|
| `find()` — the scan in C | 0.66–0.70 ms | ~3.5 ns |
| the same loop in Ring | 16.4–17.7 ms | ~88 ns |
| **ratio** | **23.5× – 26.9×** | |

Both return index 200000. The prediction held at the top of its range.

So the number Ring++ is built on is real: **a loop moved out of the
interpreter is worth roughly 25× on list traversal.** Not 2×, and not 100×.

## What I have not done

- The [Google Group thread](https://groups.google.com/g/ring-lang/c/kHAlmVcP1tU)
  needs a logged-in browser; it is still unread.
- `vminfo_e.c` and `state.c` were surveyed for surface, not read closely.
  The `ring_state_*` family being callable from Ring — Ring hosting Ring —
  is the biggest unexplored item and deserves its own pass.
- The design document itself. This is stage one only.

## The thesis this leaves

Ring++ is **a catalogue of removed iterations**, exposed as ordinary Ring
functions, with the unsafe primitives confined to a core layer nobody has to
read. Not a pointer library. The pointer surface is the implementation
detail; the product is that a loop the programmer would have written does
not run.

The next honest step is to prove the 10–30× on one real operation before
designing around it.
