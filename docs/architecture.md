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
  No frameworks, no dependencies, classic script.

## 2. How an eval works

`ring.eval(code)` travels this path:

1. The loader copies the source into wasm memory and calls `rs_eval`.
2. The bridge appends a **region terminator** (a uniquely-named, never
   instantiated class) — closing any class region that would otherwise
   be terminated incorrectly at end-of-eval — and runs the code through
   a Ring-level shim: `try eval(rs_getcode()) catch rs_reporterror(cCatchError) done`.
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
│   ├── gates.js                 29 permanent gates
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
node tests/gates.js             # 29 permanent gates: residency, errors,
                                #   memory, io, bridge, line numbers
node tests/examples-oracle.js   # playground/examples/*.ring vs native ring.exe
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
