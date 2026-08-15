# The upstream case — findings from RingScript, prepared for ring-lang/ring

*HEADROOM_PLAN.md P6. Four self-contained items, each written so it can
be posted as its own GitHub issue or discussion. Everything below was
found while building RingScript (the Ring 1.27 VM compiled to
WebAssembly, byte-exact against native across ~850 programs) and every
measurement was **re-verified on stock native `ring.exe` 1.27.0 on
Windows** before being written here — none of this is a wasm quirk.
Items 1 and 2 follow the route of
[ring-lang/ring#1639](https://github.com/ring-lang/ring/pull/1639),
which contributed two earlier fixes from the same work.*

> **SUPERSEDED. All four items are closed, and the register moved.**
> The status of every item, the reproductions and what came back from the
> Ring project now live in **RingUpstream**
> (`D:\GitHub\ringupstream`, [`REGISTER.md`](https://github.com/mayouni/ringupstream)).
> The `docs/upstream/` directory this page used to point at was moved
> there whole on 2026-08-15. **Nothing here is pending; nothing here
> should be sent.**
>
> Corrected 2026-08-15 — this page was wrong about all four:
>
> - **Items 1 and 2** were recorded as delivered and *"consciously
>   deferred to a PWCT reimplementation"*. They were **applied**:
>   [`7acf95bf`](https://github.com/ring-lang/ring/commit/7acf95bf) and
>   test [`5eb676ca`](https://github.com/ring-lang/ring/commit/5eb676ca)
>   for the eval crash,
>   [`4014382a`](https://github.com/ring-lang/ring/commit/4014382a) for
>   `ring_vm_stringtonum`, six days after #1639 closed.
> - **Item 3** was *"the one genuinely new finding, ready to send"*. It
>   was sent as [#1648](https://github.com/ring-lang/ring/pull/1648) and
>   closed: *"You already shared this before in Ring Group."* The GitHub
>   search that preceded it was clean — the group cannot be searched
>   without a login, which is why RingUpstream's check ends with a
>   question to Mansour rather than a query.
> - **Item 4** is obsolete, and that part was right: Ring already ships
>   `ring_vm_computedgoto()` in `language/build/vmcgoto/vmcgoto.c`, which
>   the vendored tree here does not include.
>
> `ring-lang/ring` **has issues and discussions disabled**, so there is no
> tracker — only pull requests and the Google Group.

*The four write-ups below are kept as the full record of each finding.*

---

## Item 1 — Bug: `eval("class ... private ...")` crashes ring.exe

**Severity: crash. One-line fix included.**

Reproduction on stock Ring 1.27.0, Windows:

```ring
eval("class q private b = 2")
see "survived" + nl
```

The process dies before printing anything (exit code 1, no error
message). The same class definition works when it is in the file
directly — the crash needs the class to arrive through `eval()`, or any
other path where code was already compiled into the state before the
class (an embedded/resident runtime hits this constantly).

**Cause.** In `ring_parser_stmt`'s `K_PRIVATE` handler (`stmt.c`),
`pParser->nClassMark` — recorded by `newlabel2()` — is a **global**
instruction number (`pGenCode size + nInstructionsCount`), but it is
passed to `ring_parser_icg_getoperationlist()`, which indexes the
**local** `pGenCode` list. When `nInstructionsCount` is zero (a plain
file run from scratch) the two coincide and everything works; with any
previously compiled code the raw index reads far past the list.

**Fix** (running in RingScript since August 2026, held by its full
oracle battery):

```c
pList = ring_parser_icg_getoperationlist(
    pParser, pParser->nClassMark - pParser->pRingState->nInstructionsCount);
```

---

## Item 2 — Portability: `strtod` errno differs under musl, breaking string/number comparison

**Severity: wrong result on musl-based builds (wasm/WASI, Alpine, …).
One-line fix included.**

In `ring_vm_stringtonum` (`vmexpr.c`), the error branch fires when
`strtod` returned 0 with `errno` set:

```c
if (nResult == 0 && (errno != 0)) { ... raise R41 ... }
```

On **no-conversion** input ("test"), MSVC and glibc leave `errno`
untouched — but musl sets `EINVAL`. So on any musl-based build,

```ring
if "test" = 5 see "equal" else see "not equal" ok
```

raises `Error (R41): Invalid numeric string` instead of printing
`not equal`. Native Windows/Linux-glibc behavior is the comparison
evaluating false.

**Fix**: guard with `cEndStr != cStr` so a plain no-conversion falls
through to the existing no-conversion branch:

```c
if (nResult == 0 && (errno != 0) && (cEndStr != cStr)) {
```

---

## Item 3 — Discussion: every string argument is copied onto the VM stack

**Severity: performance, quadratic in practice. Measurement, root
cause, and options — a design decision for Mahmoud, not a patch.**

Reproduction on stock Ring 1.27.0, Windows (`len()` is O(1) work in
both loops — only the argument size differs):

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

Measured native: **1 ms vs ~4,900–5,000 ms — roughly 5,000×** for
identical work (four runs). About twenty gigabytes memcpy'd to answer
twenty thousand length queries.

**Cause.** `RING_VM_STACK_PUSHCVAR` (`vm.h`):

```c
#define RING_VM_STACK_PUSHCVAR \
    ring_itemarray_setstring2_gc(pVM->pRingState, pVM->aStack, pVM->nSP, \
                                 ring_list_getstring(pVar, RING_VAR_VALUE), \
                                 ring_list_getstringsize(pVar, RING_VAR_VALUE))
```

Every use of a string variable as a function argument copies the whole
value onto the VM stack. The consequence is that **any** Ring code
touching a large string repeatedly — a parser, a codec, a text
processor — is O(len) per touch and O(n²) overall. In RingScript this
was the root cause of a pure-Ring JSON codec decoding at 0.27 MB/s
while Lua's pure-Lua equivalent manages 7.5 MB/s on the same machine —
a 28× gap owed partly to Lua's C string primitives, but the quadratic
component of it entirely to this copy.

**Options, in rising order of ambition** (offered as data for a
decision, since the copy also gives Ring its clean value semantics):

1. **Borrowed arguments for read-only builtins.** `len()`, `ascii()`,
   `substr()` (source argument), `left/right/copy/find` never mutate
   their string argument. A flag on the C-function registration ("does
   not retain or mutate") could let PUSHCVAR push a pointer for exactly
   those calls. Smallest semantic surface, covers the hot cases.
2. **Copy-on-write strings.** Reference-count the string buffer; copy
   only when a writer appears. Bigger change, benefits everything,
   needs care with the GC.
3. **The existing `RING_OBJTYPE_SUBSTRING`** machinery suggests the VM
   already has vocabulary for "a view into a string" — perhaps it can
   carry more of this weight.

RingScript worked around it by moving its JSON codec to C, but every
pure-Ring program on every platform still pays this. Happy to
contribute benchmarks, test programs, or prototype work if one of
these directions is of interest.

---

## Item 4 — Offer: `ring_vm_computedgoto`, the function vm.c already asks for

**Severity: none — an implementation of an existing hook, offered as a
PR if wanted.**

`vm.h` declares `ring_vm_computedgoto()` under `#ifdef
RING_VM_COMPUTEDGOTO`, `ring_vm_mainloop()` calls it, and the comment
says *"The next function must be written if RING_VM_COMPUTEDGOTO is
enabled."* RingScript wrote it: generated mechanically from
`ring_vm_execute()`'s switch — one label per opcode, bodies identical,
label table in `codegen.h` enum order, fetch + dispatch + the stack
check consolidated into one loop with no function call per
instruction.

Measurements so far are from **wasm**, where computed goto lowers to
the same `br_table` as a dense switch, so the win there is only the
loop consolidation: nothing measurable at `-Os`, a consistent ~9% on
dispatch-bound code at `-O2`. On **native x86/ARM**, where the
distributed indirect jumps interact with real branch prediction, the
technique classically pays considerably more — that measurement would
need to be taken on native Ring, and the generated function plus its
generator script come with the offer.

Purely additive and guarded: without the define, `vm.c` compiles
exactly as today. The one maintenance rule: regenerate when the opcode
enum changes.

---

## Also available on request

While building an object template cache, RingScript measured `new` on
an attributes-only class at **31× the cost of an equivalent list**
(native and wasm agree on the shape): each instantiation re-executes
the class-region bytecode inside a full VM state save/restore to
produce the same NULL attributes every time. RingScript now scans the
region bytecode once and replays eligible classes (~1.9× today), with
Ring's global-vs-attribute conflict rule preserved — the approach,
measurements, and the conflict-rule test corpus are available if
class instantiation performance ever becomes an upstream topic.
