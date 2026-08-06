# Architecture

*Goal of this page: understand how RingScript works inside, find your
way around the repository, and change the runtime with confidence.*

## 1. The big picture

```
 your page (HTML/CSS)                      the runtime (one .wasm file)
┌─────────────────────────┐               ┌──────────────────────────────┐
│  ringscript.js (loader) │   WASI +      │  bridge (Zig)                │
│  · WASI shim            │◄─ ringscript ─►│  · resident RingState       │
│  · js_dispatch / js_give│   imports     │  · eval/call/error shims     │
│  · boot()/load() API    │               │  · embedded ringlib map      │
└─────────────────────────┘               │  Ring VM (vendored C, 1.27)  │
                                          │  · compiler + VM, unmodified │
                                          │    except 4 marked patches   │
                                          └──────────────────────────────┘
```

Three layers, three languages, each doing the one thing it is best at:

- **The vendored Ring VM** (`ringvm/`) — Ring's own C source,
  compiled to `wasm32-wasi` by Zig. Not a port, not a rewrite: the same
  compiler and VM that power `ring.exe`, which is why output is
  byte-identical to native.
- **The bridge** (`src/bridge.zig` + `src/wasi_stubs.c`) — a small
  resident layer exporting a stable C-style API
  (`rs_init/rs_eval/rs_call/rs_last_output/…`) and owning the things a
  browser runtime must own: the one long-lived `RingState`, error
  trapping, the input queue, the embedded file map, value printing.
- **The loader** (`playground/ringscript.js`) — the only JavaScript: a ~150
  line WASI shim (clocks, randomness, stdout) plus the public API.
  No frameworks, no dependencies, classic script. It is hand-written, and
  therefore the densest source of defects per line in the project — a
  mistake there is silent, since the VM keeps running and merely reports
  something plausible. `tests/wasi.js` holds it to the host's own clock,
  encoding and ordering rather than to its opinion of itself.

## 2. How an eval works

`ring.eval(code)` travels this path:

1. The loader copies the source into wasm memory and calls `rs_eval`.
2. If the source could open a region — it mentions `class`, `func`, `def`
   or `package`, or keywords have been renamed — the bridge appends a
   **region terminator**: a uniquely-named, never instantiated class,
   closing a region that would otherwise be terminated incorrectly at
   end-of-eval. The name must be unique (Ring rejects a repeated class
   definition) and is therefore permanent, so it is emitted **only when
   needed**: every eval used to add one, and the class list grew by one
   per eval — unbounded, in exactly the long-lived page this runtime is
   for. Declaration-free evals now add nothing.
   The code then runs through a Ring-level shim:
   `try eval(rs_getcode()) catch rs_reporterror(cCatchError) done`.
   The `rs_getcode` hook hands the source over *by reference*, so no
   string escaping exists anywhere in the pipeline.
3. Output flows into a growable buffer: `see`/`?`/`put` through the
   `ringvm_see` hook; C-level `print()` through the WASI `fd_write`
   import, which (with `captureStdout`) re-enters the wasm to append at
   the exact right position. Values print through mirrors of the VM's
   own printers — objects as `attr: value` lines, circular lists as
   `[...] (RC:n)`, numbers via the live `decimals()` setting.
4. Errors — compile or runtime — are trapped by the catch shim. The
   real line number is captured *at error time* (a vendor patch;
   catch-time state restoration would have erased it) and reported as
   `line N: message`. The VM survives.
5. If the code defined `func main` and nothing ran it, the bridge runs
   it once — matching native Ring's end-of-program behavior, which the
   eval path cannot reach on its own.

`ring.call` rides the same machinery with generated glue:
`rs_setresult(JsonEncode(F(JsonDecode(rs_getarg()))))`.

## 3. Design decisions worth knowing

- **No filesystem, by construction.** Every `fopen` in the VM is
  redirected (`-Dfopen=rs_fopen` at compile time) to a resolver over
  the embedded file map; `fmemopen` gives the VM a real read-only
  `FILE*` over embedded bytes. `load` works; writes fail like a missing
  file; there is nothing to sandbox because there is nothing there.
- **`give` is a hook, not stdin.** Ring routes `give` through a
  replaceable `ringvm_give` function; the bridge's implementation reads
  the eval's input queue, then asks the host live (`js_give` →
  `onGive`/`prompt`), then raises a clean error. Interactive programs
  stay interactive; nothing hangs.
- **One resident state, explicit resets.** `rs_reset()` is the only way
  the VM is recreated. Nothing implicit, ever.
- **8 MB wasm stack.** Deep parser recursion and deeply nested lists
  (2000 levels verified) need more than the 1 MB default.
- **Vendor purity with four exceptions.** The Ring source is compiled
  as-is, plus four small patches each marked `RINGSCRIPT PATCH` in
  place and documented in [VENDOR_PATCHES.md](VENDOR_PATCHES.md) — two
  of them fix upstream bugs that were contributed back
  ([ring-lang/ring#1639](https://github.com/ring-lang/ring/pull/1639)).

## 4. Repository layout

```
ringscript/
├── build.zig                    wasm runtime + dev server + serve/dist steps
├── start-playground.bat         double-click launcher (Windows)
├── start-playground.sh          double-click launcher (macOS / Linux / BSD)
│
├── package.ring                 RingPM manifest (what a user downloads)
├── main.ring                    `ringpm run ringscript` — self-locating CLI
├── lib.ring                     the same operations, callable from Ring
├── cli/starter.html             template used by `new`
├── bin/                         prebuilt servers, ~40 KB each, COMMITTED:
│                                RingPM ships one per platform, no Zig needed
│
├── src/
│   ├── bridge.zig               the bridge (§2) + the embedded file map
│   ├── wasi_stubs.c             fopen resolver, exact-mirror value printers,
│   │                            VM accessors — the only added C
│   ├── serve.zig                embedded dev HTTP server (correct wasm MIME)
│   └── ringlib/                 pure Ring baked into the wasm
│       ├── json.ring            the pure-Ring JSON codec
│       ├── seam.ring            Page() and Platform(), the outward seam
│       ├── stzZql.ring          the ZQL engine — see docs/zql-payload.md
│       └── stzzql_smoke.ring    its test suite
│
├── ringvm/                      vendored Ring 1.27 (src + include) + 4 patches
│
├── playground/
│   ├── index.html               the Playground (the site's single page)
│   ├── examples/                the 24 examples, one plain .ring file each
│   ├── examples-data.js         their manifest (id / title / give answers)
│   ├── site.css                 shared design tokens
│   ├── ringscript.js            the loader + WASI shim (the whole JS side)
│   └── ringscript.wasm          built runtime — committed (zig build refreshes)
│
├── tests/                       verification — see §6
│   ├── gates.js                 36 permanent gates
│   ├── soak.js                  long-session endurance (what accumulates?)
│   ├── fuzz.js                  hostile input (can the loader be made to throw?)
│   ├── wasi.js                  the hand-written WASI shim, against the host itself
│   ├── bench.js                 speed and size vs a recorded, calibrated baseline
│   ├── bench-baseline.json      what a regression is measured from
│   ├── examples-oracle.js       Playground examples vs native ring
│   ├── samples-sweep.js         bulk corpus sweep vs native ring
│   ├── extract-doc-snippets.js  builds the doc corpus from your Ring install
│   └── ring-exe.js              locates the native oracle on any platform
│
└── docs/                        you are here
```

## 5. Building and developing

```bash
zig build            # build the wasm (ReleaseSmall by default, ~350 KB)
zig build serve      # ...and serve playground/ at http://localhost:8377/
zig build dist       # cross-compile the server for all shipped platforms
zig build -Ddebug    # debug build of the wasm, when you need one
```

**Release is the default on purpose**: `playground/ringscript.wasm` and
`bin/ringscript-serve-*` are committed release artifacts (RingPM
downloads them as-is, with no build step on the user's machine), so an
ordinary build must never leave a debug binary in their place. Refresh
both — `zig build && zig build dist` — when bumping the version.

**Zig is the only dependency** — this repository builds with **0.15.2**
(get it from <https://ziglang.org/download/>, or your package manager:
`winget install zig.zig`, `brew install zig`, `snap install zig
--classic --beta`, `pacman -S zig`, `scoop install zig`; check with
`zig version`). There is no `build.zig.zon`, so nothing is fetched at
build time; the dev server (`src/serve.zig`) is part of the build — no
Node, no Python, no CMake. Iterating: edit `src/bridge.zig` or a page in
`playground/`, re-run `zig build serve`, refresh the browser.

Node.js and a native Ring install are needed **only** for the test
suites in §6, never to build or run the runtime.

### Extending the embedded library

1. Drop `mylib.ring` into `src/ringlib/`.
2. Add one entry to `embedded_files` in `src/bridge.zig`:
   ```zig
   .{ .name = "ringlib/mylib.ring", .data = @embedFile("ringlib/mylib.ring") },
   ```
3. `zig build serve` — now `load "ringlib/mylib.ring"` works in any page.

Keep embedded libraries **pure Ring** (no file/OS calls) — that's the
contract that makes them portable into the browser unchanged.

### Upgrading the vendored Ring

Replace `ringvm/` with the new version's `ringvm/src` +
`ringvm/include`, re-apply the four patches from
[VENDOR_PATCHES.md](VENDOR_PATCHES.md), rebuild, and run the full test
battery (§6) — the gates fail loudly if a patch is missing. The 1.25 →
1.26 → 1.27 upgrades in this repository's history each took minutes.

## 6. Verification

Every claim in these docs is executable:

```bash
node tests/gates.js             # 36 permanent gates: residency, errors,
                                #   memory, io, bridge, line numbers
node tests/examples-oracle.js   # playground/examples/*.ring vs native ring.exe
node tests/soak.js              # 40,000 evaluations: nothing may accumulate
node tests/fuzz.js              # 4,000 hostile inputs: eval must never throw
node tests/wasi.js              # the WASI shim: clocks, encoding, output ordering
node tests/bench.js             # speed and size vs the recorded baseline
node tests/samples-sweep.js     # ~284 official Ring samples vs native
node tests/extract-doc-snippets.js && \
node tests/samples-sweep.js --root=tests/doc-snippets --dirs=.
                                # ~550 Ring-documentation examples vs native
```

The oracle suites run each program through **both** the wasm runtime
and a native `ring.exe`, then compare byte-for-byte (nondeterministic
programs — clock, random, date — are required to run cleanly rather
than match). Current status: **zero mismatches, zero failures**.

`examples-oracle.js` reads its programs straight out of
`playground/examples/` — the very files the Playground fetches — so what
is verified is what a reader is shown, not a copy of it. Adding an
example means adding the `.ring` file and one manifest line in
`playground/examples-data.js`; the oracle then covers it automatically,
and the file stays runnable with `ring.exe` on its own.

## 7. Performance

Recorded baselines, not aspirations: `tests/bench.js` measures these on
every run and fails if one regresses beyond 40%. Taken on an Intel Core
5 210H, Node 22, `ringscript.wasm` at 364,061 bytes.

| | min | what it exercises |
|---|---|---|
| instantiate + `rs_init` | **5.6 ms** | cold start — the number a page pays |
| `? 1+1` | 0.096 ms | one full eval round trip |
| 10,000-iteration loop | 0.739 ms | VM dispatch |
| build a 2,000-char string | 0.276 ms | string growth |
| sort a 2,000-element list | 0.300 ms | library call |
| create 2,000 objects | 6.02 ms | allocation |
| 1,000 lines of output | 0.903 ms | the `see` hook |
| `ring.call` from JS | 0.104 ms | the bridge, JSON both ways |
| parse a ZQL declaration | 1.55 ms | the shipped payload |
| JSON encode 8.7 KB | 12.4 ms | the pure-Ring codec |
| JSON decode 8.7 KB | **28.3 ms** | ...and its slower half |

Two things are worth reading off that table. **Startup at 5.6 ms** is the
figure that matters most for a page, and it is comfortable. **JSON
decoding is the slowest thing here** — a character-at-a-time parser
written in Ring, at roughly 300 KB/s. It is fast enough for the bridge's
own traffic (arguments and results), and it is the first place to look
if a page ever moves bulk data across the seam.

Four details make the baseline honest rather than decorative:

- **It is calibrated.** Milliseconds mean nothing on someone else's
  machine, so each run also times a fixed JS workload — integer
  arithmetic plus a strided walk over 4 MB, because interpreting Ring
  chases pointers rather than staying in registers — and compares
  *ratios*.
- **It reports the minimum.** Timing noise is always additive; a sample
  is never faster than the truth. The median is printed beside it to
  show the spread.
- **Anything over the line is measured again** before it is called a
  regression. Run-to-run noise here is ±8%, far inside the tolerance,
  but a background process landing on the wrong core can inflate a
  single benchmark — and a suite that cries wolf gets ignored, which
  protects nothing.
- **Size is gated harder than speed** (2%, and it needs no calibration).
  This project has twice chosen the smaller binary over the faster one —
  ReleaseSmall over ReleaseFast, the Ring ZQL over the Zig one — so a
  harness watching only speed would quietly reward the trade it has
  already rejected.

Verified by measuring a debug build against the baseline: all eleven
benchmarks fail on both the first and the second look (+68% to +310%),
as does the size check (+631%). And the release build is
**reproducible** — rebuilding after a debug build returns the committed
artifact byte-for-byte.

Re-record with `node tests/bench.js --update`, and say in the commit
message why the numbers moved.
