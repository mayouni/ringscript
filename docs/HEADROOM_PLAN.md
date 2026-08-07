# Making Ring compete with Lua — the plan, from root causes up

*Written August 7, 2026, after [rivals.md](rivals.md) put numbers on
every gap. Each item below is tied to a root cause verified in the
vendored source or measured directly — nothing here is a hunch. Status
markers are updated as items land.*

## The constraint that shapes everything

RingScript's crown jewel is **byte-exact conformance** — ~850 programs
identical to native `ring.exe`, held by a 4-patch vendor discipline.
Speed bought with semantic drift is a loss. So every intervention is
ranked by *where* it lives:

1. **loader** (JavaScript, zero semantic risk)
2. **bridge C** (our code, the full battery gates it)
3. **vendor patch** (surgical, upstreamable — the
   [#1639](https://github.com/ring-lang/ring/pull/1639) route)
4. **upstream-only** (Mahmoud's call; we bring measurements)

And the size gate stays: ReleaseSmall was chosen over a 6.2× binary
for ~15% speed. Nothing here re-litigates that without new numbers.

## Root causes, measured

| gap ([rivals.md](rivals.md)) | root cause (verified) |
|---|---|
| fresh evaluator 6.7 ms vs Lua's 0.15 | the loader recompiled 371 KB of wasm **per instance**; peers compile once. Plus `rs_init` parses ringlib |
| eval overhead 95 µs vs 2 µs | `eval("")` alone costs **89 µs**: the eval-shim string is compiled, Ring's `eval()` compiles the user code, then the auto-main shim compiles again — *three scanner passes per eval*, two of them constant strings |
| big strings O(n) per touch — `len(1 MB)` measured **190× slower** than `len(10 B)` for identical work | `RING_VM_STACK_PUSHCVAR` (`ringvm/include/vm.h`): **every string argument is memcpy'd onto the VM stack**. One macro underlies the old JSON quadratic, the 28× codec gap, and every big-string slowdown |
| dispatch 12.7× vs Lua | `ring_vm_fetch` is a **function call per instruction**, plus a 124-case switch and a stack check per opcode. Not variable lookup — locals measured no faster than globals |
| objects 31× vs Lua tables | plain list 0.34 µs, empty class **1.6 µs**, +0.57 µs *per attribute*: the class-region bytecode re-executes on every `new` |
| `ring.call` 73 µs | shim compiles + the pure-Ring JSON codec both ways |

One gift found in the source: the vendor already left the hook —
`RING_VM_COMPUTEDGOTO` is `#ifdef`'d in `ringvm/src/vm.c` with
`ring_vm_computedgoto` declared and a comment inviting its
implementation.

## The six fronts

### 1. Startup — loader only, biggest easy win — **DONE, premise corrected**
Executed August 7, 2026, and the measurement corrected the plan: the
wasm compile was only ~1.1 ms of the 6.7 — the bulk was `_initialize` +
`rs_init` (~5.5 ms: libc constructors, building the RingState, parsing
ringlib). Three loader-tier moves landed:

- the compiled `WebAssembly.Module` is cached (identity-keyed, promise
  stored, failure evicts);
- the **first instance donates a post-init memory snapshot**, and every
  later instance is stamped from it — grow-free memcpy instead of
  running init again. Verified equivalent: no leftover state, classes
  and errors behave, embedded loads resolve, and the unseeded
  `random()` sequence is byte-identical; the whole battery runs on
  stamped instances by construction. Costs one instance-worth of RAM
  (~21 MB) per cached module; `opts.snapshot === false` opts out;
- the wasm now declares `initial_memory` = the 332 pages `rs_init`
  grows to anyway, removing `memory.grow` from init and stamp alike
  (a limits field — binary size unchanged).

Result: fresh evaluator **6.7 → 3.3 ms** (2×), the rest of the bench
flat. The remaining ~2 ms is the page-fault cost of first-touching
21 MB of fresh memory — physics, not code. The 1–2 ms the plan hoped
for was optimistic; ringlib stays resident at init because lazy-loading
it would change observable behavior (`JsonEncode` is documented as
available without a `load`, and `seam.ring` depends on it), and
semantics outrank milliseconds.

### 2. Per-eval overhead — bridge, then one careful vendor question — **DONE (half of it), premise corrected**
*Executed August 7, 2026.* The resident-driver idea (b) died on
inspection: a driver **function** would run `eval()` in function scope,
so `x = 5` inside user code would become a local of the driver and
state persistence would silently break. Scope semantics outrank
microseconds; not done, not doable at the bridge tier.

The auto-main skip (a) landed, and measurement improved on the plan:
the main pass was itself wrapped in the eval shim, so every eval paid
**four** compiles, not three — and skipping it removes two. Evals that
mention neither `main` nor `eval` (the word an inner definition could
hide behind) skip the pass outright; `load` needs no guard because the
only loadable files are the embedded ringlib and none defines main.

Measured: `eval("")` **89 → 32 µs**, `x = 1 + 1` **105 → 48 µs** —
inside the plan's 15–40 µs target zone at the top. The 32 µs floor is
one shim compile + the user code's own compile, which is scanner
territory: P4's per-file `-O2` is the remaining lever.

### 3. Strings at scale — C powerhouse now, upstream case later — **codec DONE**
*Executed August 7, 2026 (the codec half; the upstream `PUSHCVAR` case is
P6 and still open).* `src/rs_json.c` implements the codec in C, registered
by the bridge as `rs_jsonencode`/`rs_jsondecode` behind a thin Ring
surface (`ringlib/json_wasm.ring`). `ringlib/json.ring` stays shipped,
untouched, as the reference and the native implementation — and a
permanent gate loads it under renamed entry points and holds the two
byte-identical (934-case differential ran clean before landing: output
bytes, decoded trees, raise() texts with positions, number-edge
delegation to the real `number()`, decimals interplay). Deep-nesting is
the one documented boundary: C recursion is capped at depth 320 —
inside the pure codec's own R4 flip zone (300–350) — raising the same
`Error (R4) : Stack Overflow` text instead of trapping the wasm stack.

Measured: encode 8.7 KB **10.2 → 0.18 ms** (55×), decode **33.1 →
0.72 ms** (46×), `ring.call` **0.127 → 0.055 ms**, 1 MB through
`ring.call` **969 → 6.1 ms** (originally 260 s). On the rivals board
Ring now wins JSON encode outright — ahead of QuickJS's native codec —
and wins the 1 MB row against everyone. Cost: **+7,967 bytes** of wasm
(+2.15%), which tripped the size gate exactly as designed and was
accepted deliberately.

#### The rest of front 3 (open)
The honest fix for `PUSHCVAR` (borrowed / copy-on-write string
arguments) is a VM semantics change that should **not** be
vendor-patched unilaterally — it goes upstream, argued with the 190×
measurement. What the bridge can do now, zero vendor risk: implement
**`JsonEncode`/`JsonDecode` in C** (`wasi_stubs.c`), reading the
argument once and building pair-lists through the Ring API, byte-exact
against the Ring codec — the 8 JSON gates define "correct". Expected:
the 28× pure-codec gap closed to native-codec class; 1 MB round trip
from ~1 s to single-digit ms; `ring.call` drops too. `json.ring` stays
shipped for native-Ring portability.

### 4. Dispatch — measure before believing
Implement `ring_vm_computedgoto` (mechanical: 124 labels, fetch inlined
into one loop) **plus** compile just the VM core (`vm.c`, `vmexpr.c`,
`vmstack.c`) with `-O2` while everything else stays small. Stated
honestly upfront: in wasm, computed goto lowers to `br_table` — the
same thing a dense switch becomes — so the native branch-prediction win
largely evaporates; the real candidate is consolidating the
per-instruction function call into one loop. Expected: 1.2–1.6× on
dispatch-bound code, judged against the size gate; keep only what
measures. Lua's fused `FORLOOP` is a compiler redesign — upstream-only.

### 5. Objects — the one risky vendor patch worth considering
A **template cache**: when a class region's bytecode is solely
attribute definitions (`class point x y z` — the overwhelmingly common
case), instantiate once and deep-copy thereafter; any executable
statement disables the cache for that class. Expected: 31× → 3–5×.
Highest risk on this page (arbitrary code in class regions,
`mergemethods`, inheritance) — lands only with the full battery plus
dedicated gates, or becomes an upstream proposal instead. Until then
the honest guidance stands: hot-path data belongs in lists (10×
cheaper); objects in the domain model.

### 6. What we do not do
No register VM, no NaN-boxing, no bytecode redesign, no fork — that
would forfeit the "same VM as `ring.exe`, byte-identical" claim that is
RingScript's reason to be trusted. No ReleaseFast: still settled.

## The honest ceiling

After all of this, Lua still wins raw dispatch — a design-generation
difference, not a bug on our side. The achievable end-state:
**startup ~1–2 ms, eval overhead ~15–40 µs, JSON in native-codec
class, objects within a small multiple, strings already winning,
robustness already at parity** — competitive on every front a real
page can feel, with [rivals.md](rivals.md) as the public scoreboard.

## Execution order

| | item | tier | risk | status |
|---|---|---|---|---|
| P1 | `WebAssembly.Module` cache + memory snapshot | loader | none | **done — 6.7 → 3.3 ms** |
| P2 | C JSON codec | bridge C | gated by the 8 JSON gates + oracle | **done — 46–55×, +7.9 KB** |
| P3 | eval-path slimming (main-skip; driver idea killed by scope semantics) | bridge | battery-gated | **done — 95 → 48 µs** |
| P4 | computed-goto + per-file `-O2`, measured | vendor patch, upstreamable | keep-only-if-wins | — |
| P5 | object template cache | vendor patch | highest — or upstream proposal | — |
| P6 | upstream case: string-arg borrowing, with measurements | upstream | none | — |

Each lands alone: full battery green, bench + rivals re-run, losses
reported next to wins — the same discipline as everything before it.
