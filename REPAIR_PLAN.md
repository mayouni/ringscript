# RingScript Repair Plan — for a dedicated session

*Written August 2026 after a fundamental review from the StzWeb consolidation
work. Self-contained: a fresh session in this folder can execute it without
any other context. Companion facts: Ring 1.26 is installed at
`C:\Ring126\ring\bin\ring.exe`; the vendored VM source here is Ring 1.25;
the Emscripten SDK is NOT currently installed (the old `D:\wasm\emsdk` is
gone) — Phase 0 reprovisions it.*

---

## 1. Mission — and non-goals

**Mission.** Turn RingScript from a proof (Ring VM runs in WASM) into a
**resident browser runtime for Ring**, good enough to script business logic
interactively in the StzWeb framework (`D:\GitHub\stzweb`): TRAIN mode,
the debugger cockpit, notebooks, education.

**Non-goals (settled elsewhere, do not reopen here):**
- Production delivery of Ring-authored logic is the Softanza delivery
  plane's job (`stzBuilder` + `zig build wasm` engine subsets — see
  stzlib `base/doc/design/SOFTANZA_DELIVERY_PLANE.md`). RingScript is the
  *interactive* niche only.
- StzWeb stays self-sufficient on JS + web standards. Ring is an OPTIONAL
  logic language; nothing in this plan may become a framework dependency.

## 2. Diagnosis (what the 2025 trial got right and wrong)

Right: the hard part. Ring's VM compiles under Emscripten and executes in
a browser (`bridge.c` + `build.bat` → `ringscript.js/.wasm`), with `see`
captured via a registered C hook.

Four structural defects make it a REPL demo, not a runtime:

| # | Defect | Where |
|---|---|---|
| D1 | **Batch, not resident** — every `run_ring()` creates and destroys a full `RingState`; no state survives between calls | `bridge.c:72-89` |
| D2 | **One-way, string-only channel** — output only via intercepted `see` into a fixed 512 KB static buffer (silent truncation); no structured returns; no Ring→JS calls | `bridge.c:8,11-18` |
| D3 | **No `load`, no files** — multi-file Ring (e.g. StzWeb's `stzZql.ring`) cannot load; browser has no FS | build flags |
| D4 | **Fragile failure** — a VM error can abort the WASM instance (`ASSERTIONS=1`, no trap-and-report) | `bridge.c`, `build.bat` |

## 2.5 Toolchain decision — Zig first, Emscripten as fallback

Re-questioned (Aug 2026) against the Zig-based work everywhere else in the
family — the stzw CLI, the Zin compiler, the Softanza engine and its
delivery-plane `zig build wasm`, and stzw's vendored SQLite (a 9 MB C
amalgamation compiled by Zig without complaint). Evidence from this repo's
vendored VM source (43 C files):

- **zero `setjmp/longjmp`** — the classic Emscripten-only requirement is absent
- **zero `pthread`**, **zero `signal()`** — no threading/signal machinery
- `dlopen/LoadLibrary` confined to `state.c` extension loading (stub out —
  a browser runtime loads no dynamic libraries)
- `fopen` confined to file-function corners (`file_e.c`, `objfile.c`,
  `general.c`, `state.c`) — wasi-libc covers or stubs them

**Decision: build the VM with `zig cc -target wasm32-wasi` in a `build.zig`,
with the bridge written in Zig (`bridge.zig`).** One toolchain family across
every project; no emsdk (Python + Node + env scripts) to provision — Zig
0.15 is already on this machine, emsdk is not. What replaces Emscripten's
conveniences:

- JS glue → a ~100-line WASI browser shim (`fd_write` → `onOutput`, plus
  the handful of clocks/random imports) — standard, vendorable, ours
- MEMFS `--preload-file` → **`@embedFile`**: Ring payload sources baked
  into the wasm as data; the bridge resolves `load` against the embedded
  map — no filesystem at all
- `EM_ASM` → Zig `extern` JS imports declared in the bridge, provided by
  the same shim

**Fallback**: if the timeboxed spike (P0) hits a wasi-libc gap that resists
stubbing, fall back to Emscripten for the VM only. The bridge API below is
toolchain-agnostic on purpose — nothing downstream changes either way.

Strategic note: with this, Zig becomes the single systems substrate of the
whole family — CLI (stzw, zin), engine (Softanza), packaging (delivery
plane), C vendoring (SQLite), and now the Ring VM's browser build. The
same `build.zig` can later emit BOTH the dev module (eval channel) and a
prod module (embedded app, no eval channel) — converging RingScript and
the stzBuild philosophy in one build.

## 3. Target architecture

One resident bridge (`bridge.zig` — or `bridge2.c` under the Emscripten
fallback), one build, exporting a small toolchain-agnostic API:

```
rs_init()                    -> create the resident RingState once
rs_reset()                   -> destroy + recreate (explicit, never implicit)
rs_eval(code) -> int         -> run code IN the resident state; 0 = ok
rs_call(fname, json) -> ptr  -> call a Ring function with one JSON arg,
                                 return a JSON string (runtime mode)
rs_last_output() -> ptr      -> accumulated output since last eval/call
rs_last_error() -> ptr       -> "" or "line N: message"
```

- **Output**: dynamically grown buffer (or chunked `EM_ASM` callback to a JS
  `ringscript.onOutput(text)` handler). The 512 KB cap and silent
  truncation go away.
- **Ring→JS**: register one C function `jscall(cName, cJson)` into the VM;
  it forwards through `EM_ASM` to a JS dispatch table. This is the seam
  that lets Ring code reach `stz.platform.*` (storage, notify) — the same
  capability contract every StzWeb bundle already ships.
- **Files**: Emscripten MEMFS via `--preload-file ringlib@/ringlib` — a
  folder of pure-Ring sources packed at build time so `load` works.
  **First payload: `D:\GitHub\stzweb\runtime\ring\stzZql.ring`** (pure core
  Ring by design, zero dependencies — written to be this payload).
- **Errors**: wrap every eval in a Ring-level `try/catch` shim (same trick
  the old bridge used for the `see` hook); `ASSERTIONS=0` in release;
  errors return through `rs_last_error()`, never abort.
- **JSON**: Ring core has no JSON. Ship a small pure-Ring `json.ring`
  (encode/decode for the pair-list convention `[:key = value]`) in the
  MEMFS payload. Alternative if it underperforms: build Ring's own
  ext/ring_json into the WASM.

## 4. Phases (each ends with a runnable verification)

**P0 — Zig-first toolchain spike (decision gate, timeboxed).**
Write `build.zig` compiling the 43 VM sources + a minimal `bridge.zig`
(`rs_eval` only) with `-target wasm32-wasi`; stub `state.c`'s dlopen path
and any wasi-libc gap that surfaces; pair it with the ~100-line WASI
browser shim. *Gate: `see 1+2` prints `3` in a browser page.* If a
fundamental blocker resists a day's work, record it in this file and fall
back to Emscripten (install emsdk, reproduce the 2025 baseline with the
old `bridge.c` first, then proceed with `bridge2.c`). Everything after P0
is identical under either toolchain.

**P1 — Resident state + unbounded output.**
`bridge2.c` with `rs_init/rs_eval/rs_last_output`; two consecutive
`rs_eval` calls share globals (`x = 5` then `see x` → `5`). Output larger
than 512 KB arrives whole.

**P2 — Error trapping.**
`rs_eval("this is not ring")` returns nonzero, `rs_last_error()` carries
line + message, and the NEXT eval still works. Loop 500 evals in a page;
memory stays bounded (watch `performance.memory` / Module.HEAP growth).

**P3 — The stzZql payload.**
Embed the `ringlib/` folder — `stzZql.ring` (copied from stzweb) and its
smoke test — via `@embedFile`, with the bridge resolving `load` against
the embedded map (Emscripten fallback: MEMFS `--preload-file`). In the
browser: `rs_eval('load "/ringlib/stzzql_smoke.ring"')` → **10 passed, 0 failed**
— the same 10/10 the test prints under native ring. This is the moment
"one grammar, three runtimes" becomes "…including in the browser".

**P4 — The two-way bridge.**
`rs_call("RunTontineFlow", '{"member":"Aminata","amount":5000}')` returns
the flow result as JSON; a Ring call to `jscall("notify", ...)` surfaces
as a JS event. Wire `jscall` to the `stz.platform` shim.

**P5 — StzWeb integration demo.**
A page in stzweb (`examples/ring-runtime/`) served by `stzw dev`: fetches
`app.zql` from the tontine example, parses and runs it **in Ring, in the
browser**, side by side with the JS runtime — same declaration, same
verdicts. This example is the educational asset for the milestone.

**P6 (stretch) — Ring 1.26 alignment.**
Swap `language/` for the 1.26 source tree (match `C:\Ring126`), rebuild,
re-run P1-P5 gates. If emcc fights 1.26, staying on 1.25 is acceptable —
document the divergence.

## 5. Acceptance criteria (the whole session in one list)

1. Baseline reproduced before modification (P0).
2. State persists across evals; output unbounded (P1).
3. Errors report and never kill the VM (P2).
4. `stzzql_smoke.ring` prints 10/10 inside the browser (P3).
5. JSON in/out both directions; `stz.platform` reachable from Ring (P4).
6. The stzweb demo page runs the tontine flow in Ring + JS side by side (P5).
7. No StzWeb file *requires* any of this — the seam stays optional.

## 6. Risks and fallbacks

- **wasi-libc gaps** (locale, exotic stdio, `system()` in `general.c`):
  stub aggressively — a browser runtime needs none of them; the P0 gate
  bounds the discovery cost, Emscripten is the recorded fallback.
- **emsdk drift** (fallback path only): 2025 flags may not build under
  2026 emcc; pin the emsdk version that builds and record it.
- **`ring_state` reuse leaks**: if the VM leaks across evals in resident
  mode, fallback to pooled states (recreate every N evals) while filing
  the real fix.
- **Perf**: interpreting Ring in WASM is fine for TRAIN/notebook use; do
  not chase production performance here — that's the delivery plane's job.

## 7. Kickoff prompt for the dedicated session

Paste this to start the session in `D:\GitHub\ringscript`:

> Read REPAIR_PLAN.md fully and execute it phase by phase, gating each
> phase on its verification before starting the next. Commit per phase
> with the phase number in the message. Toolchain: Zig-first per §2.5
> (zig 0.15 is installed; emsdk is not) — Emscripten only through the
> P0 fallback gate. The stzZql payload comes from
> D:\GitHub\stzweb\runtime\ring\ (copy, don't move). Windows, French
> locale, PowerShell 5.1: one command per line, never `&&`. CLI and page
> output must be visually calm: wrapped lines, spacing, readable colors.
