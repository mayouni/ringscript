# RingScript — the Ring language, resident in your browser

RingScript compiles the [Ring](https://ring-lang.github.io/) VM to
WebAssembly and wraps it in a small, resident bridge, so Ring code can be
evaluated interactively in a web page — with persistent state, trapped
errors, embedded libraries, and a two-way JSON bridge to JavaScript.

It exists to give the **StzWeb** framework (`D:\GitHub\stzweb`) an
*optional* Ring logic backend: TRAIN mode, the debugger cockpit,
notebooks, education. Production delivery of Ring-authored logic is the
Softanza delivery plane's job — RingScript is the interactive niche, by
design (see [REPAIR_PLAN.md](REPAIR_PLAN.md)).

## Architecture

Zig-first, no Emscripten (decision record in REPAIR_PLAN.md §2.5):

```
build.zig          compiles language/src (vendored Ring 1.27 VM, 41 files)
                   + bridge.zig with `zig cc -target wasm32-wasi`
bridge.zig         the resident bridge: rs_init / rs_reset / rs_eval /
                   rs_call / rs_last_output / rs_last_error, the see-hook,
                   the try/eval/catch error shim, @embedFile payloads
wasi_stubs.c       the only C we add: tmpfile stub, list-macro wrappers,
                   and rs_fopen — every VM file access resolves against
                   the embedded ringlib/ map via fmemopen (no filesystem)
ringlib/           pure-Ring payload baked into the wasm:
                   stzZql.ring (+ smoke test) and json.ring
web/ringscript.js  ~250-line hand-written WASI browser shim + loader
                   (fd_write → onOutput, jscall → JS handlers/DOM events)
web/index.html     minimal REPL page      web/serve.js  static server
legacy/            the 2025 Emscripten proof (bridge.c, build.bat) —
                   preserved as the documented fallback path
```

## Build and run

Requires Zig 0.15+ and Node (for the test gates). No emsdk, no npm.

```bash
zig build -Drelease=true
```

Artifacts land in `zig-out/bin/` and are copied to `web/`
(`ringscript.wasm`, ~340 KB). Then:

```bash
node web/serve.js
```

and open <http://localhost:8377/> — a REPL page against the resident VM —
or <http://localhost:8377/examples.html>, a gallery of classic Ring
examples (interactive input, OOP, brace magic, Arabic keywords…) that all
match native ring.exe output byte-for-byte
(`node tests/examples-oracle.js` verifies this against `D:\ring127`).

## Verification

Every phase of the repair plan ends in a runnable gate:

```bash
node tests/gates.js
```

- **P0** `see 1+2` → `3` (toolchain)
- **P1** globals survive across evals; 1.23 MB output arrives whole
- **P2** errors report via `rs_last_error()` and never kill the VM;
  memory flat across 500 ok + 500 failing evals
- **P3** `load "ringlib/stzzql_smoke.ring"` → **10 passed, 0 failed** —
  the stzZql grammar engine, in Ring, in the browser
- **P4** `rs_call` runs a stzZql flow and returns its verdict as JSON;
  Ring's `jscall("notify", …)` surfaces as a JS handler call / DOM event

The end-to-end demo lives in stzweb:
`examples/ring-runtime/` (serve with `stzw dev`) fetches the tontine
`app.zql` and runs the same flow through zql.js and through Ring-on-wasm,
side by side — same declaration, same verdicts.

## JS API

```js
const ring = await RingScript.load("ringscript.wasm", {
    onOutput: text => console.log(text),      // VM stdout/stderr
    captureStdout: true,                      // or: route print()/puts into
});                                            // the eval output, in order
ring.eval('see 1+2');                          // { ok, output, error }
ring.eval('x = 5'); ring.eval('see x');        // state persists
ring.eval('give n see n', "Mansour\n");        // input queue for `give`
ring.call("MyFunc", { any: "json" });          // { ok, result, output, error }
ring.on("notify", payload => ({ ack: 1 }));    // Ring: Platform("notify", …)
ring.reset();                                  // explicit fresh state
```

Native-fidelity details the bridge takes care of: `? obj` prints object
attributes like native Ring; `give` echoes its input (terminal-style) and
raises a trappable error when the queue runs dry; a defined `func main`
auto-runs once after top-level code; a class with only attributes at the
end of an eval works (the bridge appends a region terminator).

## Known limitations

- No real filesystem: file reads resolve against the embedded `ringlib/`
  map; writes fail like a missing file. That is the design.
- Ring 1.27 VM (vendored from `D:\ring127`), carrying two small marked
  patches for real error-line numbers — see
  [VENDOR_PATCHES.md](VENDOR_PATCHES.md); re-apply them on any vendor
  swap. The 1.25 and 1.26 trees are in git history.

## Origin

Created by **Mansour Ayouni**, creator of the Softanza library for Ring,
with AI assistance. The 2025 Emscripten prototype that proved the idea is
preserved under `legacy/`; the 2026 repair (this architecture) was
executed against [REPAIR_PLAN.md](REPAIR_PLAN.md).

## License

MIT License.
Copyright (c) 2026 Mansour Ayouni (kalidianow@gmail.com)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
