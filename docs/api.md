# The JavaScript API

*Goal of this page: every call, option and convention of the loader —
with the reasoning behind each.*

The whole API surface is one global, `RingScript`, with two entry
points. Nothing else is global (except `window.ring` when *you* ask
`boot()` to create it).

```js
RingScript.boot(opts?)  -> Promise<ring>   // page-scripting mode
RingScript.load(src, opts?) -> Promise<ring> // programmatic mode
```

## boot(opts) — page-scripting mode

```js
const ring = await RingScript.boot();
```

Does four things, in order:

1. loads the wasm (default `"ringscript.wasm"`, next to your HTML —
   override with `opts.wasm`);
2. registers the DOM seam handlers `settext` / `gettext` / `getvalue`
   (documented in [Scripting pages](scripting-pages.md#3-the-dom-seam-precisely));
3. evaluates every `<script type="text/ring">` block, in document
   order, in the one resident VM;
4. exposes the instance as `window.ring` so inline handlers can write
   `onclick="ring.call('Fn')"`.

`boot()` accepts every option `load()` accepts.

## load(source, opts) — programmatic mode

```js
const ring = await RingScript.load("ringscript.wasm", {
    onOutput: text => term.write(text), // stdout/stderr as it happens
    captureStdout: true,                // (see "Two output channels")
    onGive: () => nextTestInput(),      // custom `give` source
});
```

`source` is a URL (fetched; falls back gracefully when the server sends
a wrong MIME type) or an `ArrayBuffer` (useful in Node and tests).

**Two output channels.** Ring-level output (`see`, `?`, `put`) is
always captured into the result of each evaluation. C-level output
(`print()`, `puts()`, VM error prints) goes to `onOutput` by default —
or, with `captureStdout: true`, is merged into the evaluation result
**in true order** relative to `see` output. For anything user-facing,
`captureStdout: true` is what you want; the default keeps a raw
console-like channel for embedders that need one.

## ring.eval(code, input?)

```js
const r = ring.eval('see 1+2');
// r = { ok: true, code: 0, output: "3", error: "" }
```

Compiles and runs Ring source **in the resident state** — definitions
persist across calls. Returns synchronously (the VM is wasm; no
promises needed):

| field | meaning |
|---|---|
| `ok` | `true` when the program completed without a trapped error |
| `output` | everything printed during this eval (binary-safe — NUL bytes survive) |
| `error` | `""`, or `"line N: message"` with the **real** line number |

**Errors never kill the VM.** After a failed eval, the state is intact
and the next eval works. This is load-bearing for playgrounds and
notebooks; it is guaranteed by the runtime's try/catch shim and
verified by 1000-eval gate tests.

**Interactive input.** The optional second argument is an input queue
for Ring's `give`, one line per read, echoed like a terminal:

```js
ring.eval('? "Name: " give n ? "Hello " + n', "Alice\n");
```

When the queue is empty (or runs dry), the program **pauses and asks
the host, live**: your `opts.onGive()` if you registered one, else a
modal `window.prompt` whose message is the program's own pending
question (the output printed so far). Only when there is no input at
all — `onGive` returned `null`, the user cancelled, or there is no
prompt (Node) — does `give` raise a clean, trappable Ring error. The
design rule behind all this: *an interactive program stays interactive;
a scripted program stays deterministic; and nothing ever hangs or dies
silently.*

**Prompt-free interactivity (the Playground pattern).** A modal prompt
is functional but blunt. For an in-page experience — output shown up to
the question, focus moved to an answer field, a *Continue* button
resuming the program — use `onGive` to *decline* (`return null`), let
the eval stop, collect the user's answer in your own UI, and **re-run
the same code with all answers so far in the input queue**. On a fresh
VM the replay is deterministic, so the program lands exactly one
question further each time — the pause is indistinguishable from real
blocking. The Playground's source (`playground/index.html`, `run()` /
`continueRun()`) is a complete ~40-line reference implementation.

**CRLF is normalized** in both code and input, matching how native Ring
reads source files in text mode.

## ring.call(name, arg)

```js
ring.eval('func Price aOrder return [ :total = aOrder[:qty] * aOrder[:unit] ]');
const r = ring.call("Price", { qty: 3, unit: 19.5 });
// r = { ok: true, result: { total: 58.5 }, output: "", error: "" }
```

The runtime-mode door: call one Ring function with one JSON-serializable
argument, get its return value back as parsed JSON. The function name
is validated (identifier characters only), the argument is decoded into
a Ring value before the call, and the result is encoded on the way out.

**Convention:** a function invoked through `call` receives **exactly
one argument** — declare it `func F aArg` even if you ignore it.
`ring.call("F")` passes `NULL`.

### JSON mapping

Implemented by a pure-Ring codec (`src/ringlib/json.ring`) embedded in
the wasm:

| JSON | Ring |
|---|---|
| object `{"k": v}` | pair-list `[ :k = v ]` |
| array | list |
| string | string |
| number | number |
| `true` / `false` | `1` / `0` |
| `null` | `NULL` |

## ring.on(name, fn) — Ring calling JavaScript

```js
ring.on("notify", payload => {
    toast(payload.msg);
    return { ack: 1 };          // travels back into Ring
});
```

Handles Ring's outbound calls. In Ring, use the high-level wrapper
(decodes the reply for you):

```ring
aReply = Platform(:notify, [ :msg = "saved" ])
see aReply[:ack]        # 1
```

or the raw form, `jscall("notify", cJsonString) -> cJsonString`, when
you want to manage JSON yourself. Calls with no registered handler are
dispatched as DOM `CustomEvent`s named `ringscript:<name>` with the
payload in `event.detail` — a zero-coupling way to observe Ring from
elsewhere in the page.

## ring.reset()

Destroys and recreates the VM — explicitly, never implicitly. All Ring
state is gone; the DOM-seam handlers and your `on()` registrations are
JavaScript-side and survive. Use it for "restart program" buttons; the
Playground instead creates a fresh instance per run, which is the right
call when examples may rewire the language itself
(`ChangeRingKeyword`).

## Loading Ring libraries

There is no filesystem — deliberately. Pure-Ring libraries are embedded
into the wasm at build time and loaded with ordinary `load`:

```ring
load "ringlib/stzzql_smoke.ring"
```

Adding your own library to the embedded set is a two-line change in the
runtime build — see [Architecture](architecture.md#extending-the-embedded-library).

## The whole API on one screen

```js
// page-scripting mode
RingScript.boot()                  // wasm + DOM seam + text/ring blocks + window.ring

// programmatic mode
ring = await RingScript.load("ringscript.wasm", { onOutput, captureStdout, onGive })
ring.eval(code)                    // { ok, output, error } — state persists
ring.eval(code, "l1\nl2")          // scripted input queue for give
ring.call("Fn", { any: "json" })   // { ok, result, output, error }
ring.on("name", fn)                // handle Ring's Platform("name", data)
ring.reset()                       // explicit fresh state
```
