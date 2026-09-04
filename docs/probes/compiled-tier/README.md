# Probe: what a compiled tier would be worth

**Run 2026-09-04. A probe, not a feature** — nothing here ships, nothing
here is a gate. It exists to answer one question with a number instead of
an argument, and to hand that number to the session that can act on it.

**The question.** Numba gives Python a `@njit` decorator: a typed subset
compiles to machine code, everything else falls back to the interpreter.
In August 2026 it reached the browser — LLVM IR to wasm objects, linked
in-process by LLD into Emscripten side modules — and reported **~250×
in wasm against ~90× natively**, the multiple being *larger* in the
browser because interpreter overhead hurts more there. Ring has the
ingredients for the same shape: Ring++ reads a type channel, RingScript
targets wasm. Before anyone designs that, two things are worth knowing:
**is there a prize, and what does the plumbing cost?**

## How to run it

```bash
zig build-exe kernel.zig -target wasm32-freestanding -fno-entry -OReleaseFast -rdynamic
node probe.js      # the ceiling, the ledger shape, the crossing
node probe2.js     # scale, and the cross-once-operate-many pattern
```

**This probe is VM-agnostic on purpose.** It compares a Ring function to a
hand-written Zig function computing the same thing, and measures the cost
of moving a list between them. It reads no VM internals and encodes no
assumption about how a list is laid out — so **it runs unchanged against a
new VM, and re-running it answers "how much of this gap did the new VM
close on its own?"** That is why it was kept rather than deleted.

## What was measured

Both sides compute the identical thing and are asserted to agree exactly
at every size (`ring=144513099 zig=144513099` at 100 000 rows, and again
at 400 000). Two workloads: a pure arithmetic loop, and the ledger's own
shape — walk every row, filter, weight, accumulate.

### 1. The prize

| | min ms | |
|---|---|---|
| 100 000-iteration loop, Ring | 12.87 | |
| the same loop, Zig → wasm | 0.084 | **154×** |
| 20 000-row aggregate, Ring | 6.52 | |
| the same aggregate, Zig → wasm | 0.021 | **316×** |
| *the same walk, touching no data* | 2.97 | *46% of the aggregate is pure loop dispatch* |

That last row matters to anyone rebuilding a VM: **roughly half the cost
is dispatch and half is boxed list access.** A VM that made list access
free would collect half of this; the other half is the dispatch loop.

### 2. Scale — where it stops being academic

| rows | interpreted | compiled | crossing | ratio | |
|---|---|---|---|---|---|
| 2 000 | 1.01 ms | 0.00 | 0.49 | 507× | invisible |
| 20 000 | 6.64 ms | 0.02 | 1.96 | 396× | invisible |
| 100 000 | 33.22 ms | 0.08 | 10.02 | 415× | **a dropped frame** |
| 400 000 | 131.98 ms | 0.19 | 39.89 | 702× | painful |

### 3. The plumbing — and the surprise

The crossing is the naive route: `JsonEncode` in Ring, `JSON.parse` on the
host, copy into the module's buffer. No cleverness, no binary format.

> **One crossing of 100 000 rows costs 9.6 ms = 0.29 of a single
> interpreted aggregate.** The plumbing is cheaper than doing the work
> once.

So break-even sits *below one operation* — and the ledger's real pattern
(cross once, then filter, sort and re-read as the user interacts) divides
it away entirely:

| operations | stay in Ring | cross + compute | compiled wins by |
|---|---|---|---|
| 1 | 33.4 ms | 9.7 ms | 3.4× |
| 5 | 166.8 ms | 9.8 ms | 16.9× |
| 20 | 667.1 ms | 10.5 ms | 63.8× |
| 100 | 3 335 ms | 13.8 ms | 242.5× |

## The finding

**1. The prize is real, and larger than Numba's** — 400–700× against
250×, because Ring pays both dispatch *and* boxed list access per element,
and a compiled kernel pays neither.

**2. The plumbing is not the bottleneck, which is the opposite of the
expectation this probe was built to test.** Even the naive JSON crossing
costs less than one interpreted pass over the same data.

**3. Therefore a new VM is FREED by this result, not constrained.** The
requirement a compiled tier places on a value representation is **not**
zero-copy in-place readability — which would constrain the whole list
design. It is *one cheap bulk export of a homogeneous numeric list*. The
naive path already clears that bar; a binary bulk export would clear it by
an order of magnitude. **Nothing here asks a VM designer to contort the
list representation.**

## The honest counterweight

**At the scale RingScript documents, the interpreted path is already
invisible.** 20 000 rows is 6.6 ms; the ledger meets its feel budget today
and would gain nothing a user could perceive. The threshold is crossed
near 100 000 rows (a dropped frame) and hurts at 400 000. **This is not a
performance fix for anything RingScript ships — it is a capability that
would open a class of application currently out of scope**, and the site
is right to keep saying *for heavy number crunching, use what you already
use* until that class has a name.

## What this probe did NOT measure

Stated plainly, because the ratio is an upper bound and would be easy to
oversell:

- **The kernel is monomorphic `f64` over a flat array.** Real Ring lists
  are heterogeneous and boxed. This compares *ideal compiled code over
  ideal data* against *interpreted code over Ring's representation* — a
  correctly measured ceiling, not an achievable number for arbitrary Ring.
- **No compiler exists.** The kernel was hand-written to match the Ring
  source line for line. Getting from a Ring function to a kernel
  automatically needs type information — which is precisely Ring++'s type
  channel, and precisely why any real version of this is a joint design
  between two sessions and not a RingScript feature.
- **No cache, no codegen, no fallback path.** Numba's hard parts —
  deciding what compiles, what refuses, and how a refusal stays honest —
  are untouched here.

## If it is ever built

The shape to copy from Numba is the *discipline*, not the machinery:
opt-in per function, a typed subset that either compiles or **refuses by
name**, and the interpreter as the always-available fallback. That is the
same doctrine this project already applies to storage-full and to card
payment under a dead network: **a named refusal beats a silent
approximation.**

*Numba: [numba.pydata.org](https://numba.pydata.org/) ·
[Numba in the browser](https://notebook.link/blog/numba-in-the-browser/)*
