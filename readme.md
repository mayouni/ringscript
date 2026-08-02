# RingScript — the Ring language, resident in your browser

RingScript compiles the [Ring](https://ring-lang.github.io/) VM to
WebAssembly and wraps it in a small resident bridge: persistent state
across evaluations, trapped errors with real line numbers, interactive
input, embedded pure-Ring libraries, and a two-way JSON bridge to
JavaScript. Zig-first — no Emscripten, no npm, no build steps beyond one
command.

## Quick start

```bash
zig build serve
```

That single command compiles the VM to wasm, refreshes the site artifact,
and serves everything at <http://localhost:8377/> with its own embedded
HTTP server:

| Page | What it is |
|---|---|
| `/` | The site — try Ring live right on the homepage |
| `/examples.html` | **Playground** — IDE with 24 editable examples (syntax highlighting, line numbers, input queue) |
| `/tutorial.html` | **Tutorial** — embedding Ring in a page, 9 steps, live runnable demos |

Requires [Zig](https://ziglang.org/) 0.15+. Node.js is only needed for
the test suites.

## Repository layout

```
build.zig            one build: wasm runtime + dev server + `serve` step
src/
  bridge.zig         the resident bridge (rs_init/rs_eval/rs_call/…),
                     error shim, embedded-file map, see/give hooks
  wasi_stubs.c       the only added C: fopen→embedded-map resolver,
                     exact-mirror value printers, VM accessors
  serve.zig          embedded dev HTTP server (`zig build serve`)
  ringlib/           pure-Ring payload baked into the wasm:
                     json.ring, stzZql.ring (+ smoke test)
language/            vendored Ring 1.27 VM source (src + include only),
                     with 4 marked patches → docs/VENDOR_PATCHES.md
web/                 the site: pages above + ringscript.js (the ~300-line
                     WASI shim & loader — the whole JS side)
tests/               verification (Node):
  gates.js           29 permanent gates (state, errors, memory, I/O, bridge)
  examples-oracle.js all 24 playground examples vs native ring.exe
  samples-sweep.js   bulk sweep: Ring's samples + doc snippets vs native
  extract-doc-snippets.js  regenerates the doc corpus from D:\ring127
docs/
  REPAIR_PLAN.md     the 2026 design & execution record
  VENDOR_PATCHES.md  the 4 vendor patches — re-apply on Ring upgrades
```

## The JS API (all of it)

```js
const ring = await RingScript.load("ringscript.wasm", {
    onOutput: t => console.log(t),   // VM stdout/stderr
    captureStdout: true,             // or: merge print()/puts into output
});
ring.eval('see 1+2');                     // { ok, output, error }
ring.eval('x = 5'); ring.eval('see x');   // state persists
ring.eval('give n see n', "Mansour\n");   // input queue for `give`
ring.call("MyFunc", { any: "json" });     // { ok, result, output, error }
ring.on("notify", p => ({ ack: 1 }));     // Ring: Platform("notify", …)
ring.reset();                             // explicit fresh state
```

The [tutorial](web/tutorial.html) walks through every call with live demos.

## Verification

```bash
zig build -Drelease=true       # build
node tests/gates.js            # 29 gates
node tests/examples-oracle.js  # 24 examples vs native ring.exe
node tests/samples-sweep.js    # ~284 official samples vs native
node tests/extract-doc-snippets.js && node tests/samples-sweep.js --root=tests/doc-snippets --dirs=.
                               # ~550 documentation examples vs native
```

Current state: **zero mismatches, zero failures** — every deterministic
program produces output byte-identical to native `ring.exe` 1.27, and
nondeterministic ones (random/clock/date) run cleanly. Programs that ask
for what the browser deliberately excludes — files, OS calls, threads,
GUI — get a clean, trappable Ring error, never a dead runtime.

## Design boundaries

RingScript is the *interactive* niche: playgrounds, notebooks, teaching,
live business-rule evaluation (see the StzWeb integration in
`stzweb/examples/ring-runtime/` — the same declaration evaluated by
zql.js and by Ring-on-wasm, side by side). Production delivery of
Ring-authored logic belongs to the Softanza delivery plane, not here.

## Origin

Created by **Mansour Ayouni**, creator of the Softanza library for Ring,
with AI assistance. The design and its execution are recorded in
[docs/REPAIR_PLAN.md](docs/REPAIR_PLAN.md); the two upstream bugs found
during hardening were contributed back as
[ring-lang/ring#1639](https://github.com/ring-lang/ring/pull/1639).

## License

MIT License.
Copyright (c) 2026 Mansour Ayouni (kalidianow@gmail.com)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
