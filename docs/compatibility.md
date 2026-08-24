# Compatibility & scope

*Goal of this page: know exactly what to expect — what works, what is
excluded and why, and where RingScript sits in the wider Ring and
Softanza landscape.*

## 1. What works: the language, verbatim

The compatibility statement is simple because it is measured, not
promised: programs that run on native Ring 1.27 produce **byte-identical
output** on RingScript, unless they touch something the browser
excludes. The measurement (re-runnable, see
[Architecture §6](architecture.md#6-verification)):

| corpus | size | result |
|---|---|---|
| Playground examples | 24 | byte-identical to `ring.exe` |
| Official samples (`samples/` of the Ring 1.27 distribution) | ~284 runnable | zero mismatches |
| Code blocks from the official documentation | ~550 runnable | zero mismatches |
| Permanent gates (residency, errors, memory, I/O, bridge, reentrancy, JSON) | 66 | all pass |
| Soak — one VM, 40,000 evaluations | 2 phases | nothing accumulates |
| Fuzz — hostile input | 4,000 cases | `eval()` never throws |
| WASI shim — clocks, encoding, ordering | 20 checks | all pass |

That includes the parts people assume would break: OOP with `private`
sections, operator overloading, `braceStart`/`braceExprEval` magic,
packages, reflection (`attributes`, `addmethod`, …), `eval` defining
classes at runtime, `ChangeRingKeyword` (Arabic syntax works), 50,000
levels of Ring recursion, 2,000 levels of list nesting, strings with
embedded NUL bytes, and `decimals()`-sensitive number printing.

## 2. What is excluded — and how exclusion behaves

Inside a browser sandbox there are no files, processes or threads —
the same rules every JavaScript app lives by. RingScript's stance on
each:

| area | behavior in RingScript |
|---|---|
| file writes, `remove`, `rename`, `tempfile` | fail like a missing/unwritable file → trappable Ring error (R35 family) |
| file reads / `load` | resolve against the **embedded library map** ([details](architecture.md#3-design-decisions-worth-knowing)); unknown paths → trappable error |
| `fexists`, `getfilesize`, `getpathtype` | answer from the same map, so `if fexists(f) ... read(f)` behaves as written |
| `direxists`, directory listing | always false/empty — there are no directories to have |
| `system()`, `chdir`, `currentdir` | compiled out (`RING_LIMITEDSYS`) |
| threads, sockets, GUI bindings (RingQt…) | not present — they are separate C extensions, never part of the core VM |
| `syssleep` | returns immediately (no blocking sleeps in a page) |
| `iswindows()` & friends, `filename()`, pointer addresses | answer truthfully *for the wasm environment* — e.g. `iswindows()` is `0`, `filename()` is `Ring_EmbeddedCode` |
| `clock()`, `time()`, `date()` | fully functional, and on the host's **local** clock. wasi-libc carries no timezone database, so the runtime applies the browser's offset itself |
| `random()` | works, but is **unseeded — exactly as in native Ring**, which repeats the same sequence on every run. Every visitor to a page therefore gets the same numbers. Seed it yourself if that matters. (The values differ from native, since the C library differs.) |

The design rule: **exclusion is an error, never a crash.** A program
that asks for the filesystem gets a catchable Ring error with a line
number; the VM and all its state survive. Nothing in the corpus above
ever brings the runtime down.

## 3. Ring on both sides of the wire

Ring already speaks server-side: **Ring WebLib** (the CGI library that
has shipped with Ring for years) and the
[**Bolt**](https://ysdragon.github.io/bolt/) web framework
(Express-style DSL, new in Ring 1.27) build and serve real sites in
Ring today. What was always missing was the *front* end — the part
browsers only ran JavaScript for.

RingScript completes that picture: the same language, the same idioms,
from the request handler on the server to the click handler in the
page. A team that knows Ring can now be a full-stack team without a
context switch.

## 4. Part of the Softanza Project

RingScript is developed within the **Softanza Project** and was made so
that Ring can serve as an **alternative frontend scripting language in
the StzWeb framework**. The working proof lives in the StzWeb
repository (`examples/ring-runtime/`): the same business declaration
(`app.zql`, a tontine savings-circle flow) is evaluated by StzWeb's
JavaScript runtime and by Ring-on-wasm, side by side — same
declaration, identical verdicts. The Ring seam is optional by design:
nothing in StzWeb requires it.

Created by **Mansour Ayouni**, creator of the Softanza library for
Ring, with AI assistance. Two upstream VM bugs found while hardening
the runtime were contributed back to Ring as
[ring-lang/ring#1639](https://github.com/ring-lang/ring/pull/1639).

## 5. Practical expectations

- **Startup**: ~390 KB of wasm (~134 KB gzipped), instantiated in tens
  of milliseconds; a Playground eval round-trip is typically 1-3 ms.
  That is the committed ReleaseSmall artifact -- the same file RingPM
  downloads, measured rather than estimated.
- **Memory**: flat across sustained use — 40,000 evaluations of
  page-shaped work leave the wasm heap unchanged, in Node and in a
  browser alike (gated, and re-runnable on your own device with
  [`playground/soak.html`](../playground/soak.html)).
- **At a hard memory ceiling** — a phone, or the 64 MB-capped test build
  — Ring's allocator exits rather than reporting failure, so the VM
  stops and `ring.reset()` (or a fresh instance) is needed. The *page*
  survives: the failure arrives as an ordinary `{ ok: false, error }`
  that says exactly that, never as an exception.
- **Performance**: interpreted Ring at wasm speed — right for page
  logic, rules, notebooks and teaching; not a number-crunching target.
- **Determinism**: same code, same input ⇒ same output as native Ring.
  When you need scripted runs (tests, CI), pass an input queue and
  everything — including `give` — is deterministic.
