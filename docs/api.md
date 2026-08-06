# The JavaScript API

*Goal of this page: every call, option and convention of the loader —
with the reasoning behind each.*

The whole API surface is one global, `RingScript`, with two entry
points. Nothing else is global (except `window.ring` when *you* ask
`boot()` to create it).

```js
RingScript.boot(opts?)  -> Promise<ring>     // page-scripting mode
RingScript.load(src, opts?) -> Promise<ring> // programmatic mode
RingScript.VERSION                           // the loader's version, e.g. "0.9"
```

Every instance also reports the runtime it loaded — `ring.version` (the
wasm's own answer, so it cannot drift from the file you shipped) and
`ring.eval("see version()").output` for the Ring language version
(1.27).

## boot(opts) — page-scripting mode

```js
const ring = await RingScript.boot();
```

Does five things, in order:

1. waits for the document to finish parsing, if it has not — so calling
   `boot()` from a `<script>` in `<head>` is safe and still finds the
   Ring blocks further down the page;
2. starts downloading every `src` file **at once**, and loads the wasm
   alongside them;
3. registers the DOM seam handlers `settext` / `gettext` / `getvalue`,
   which Ring reaches through `Page(name, data)`
   (documented in [Scripting pages](scripting-pages.md#3-the-dom-seam-precisely));
4. publishes the instance as `window.ring`, so inline handlers such as
   `onclick="ring.call('Fn')"` work from this moment — *before* the page's
   Ring code has run, not after;
5. evaluates every `<script type="text/ring">` block, in document order,
   in the one resident VM.

`boot()` accepts every option `load()` accepts.

**Downloading is parallel; running is sequential.** A block may carry a
`src` — `<script type="text/ring" src="helpers.ring">` — in which case
the file is fetched and evaluated in place of the tag's own text, the way
an ordinary `<script src>` ignores its inline content. The files are
fetched together because they do not need each other to *arrive*, only to
*run*; each block still finishes before the next begins, so later files
may use whatever earlier ones defined. Fetching them one at a time cost a
round trip each: ten files took 477 ms against 71 ms, and that was over
localhost.

**A file that fails is reported and skipped**, and the remaining blocks
still run — the same thing the browser does with a broken `<script src>`.
Read the *first* console error: the later ones are usually just Ring
reporting functions the missing file was supposed to define. Three cases
are named explicitly rather than left to a syntax error: an HTTP status
(the path is wrong), a page served instead of the file (a 404 page or a
single-page-app fallback answering with HTML), and a blocked fetch
(the page was opened from `file://` instead of over http).

**Clicks that arrive during startup do not throw.** Until the VM exists,
`window.ring` answers with `{ ok: false, error: "...still starting..." }`
and warns on the console, so an impatient click leaves a message rather
than `ReferenceError: ring is not defined` and a dead button. `ring.booting`
is `true` while that placeholder is in place. If you need certainty, wire
controls inside `boot().then(...)`.

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

### Payload size, and untrusted data

`ring.call`'s argument and result cross the seam as JSON, encoded and
decoded by a pure-Ring codec (`src/ringlib/json.ring`). Both directions
are linear in the payload, and a 1 MB value round-trips in well under a
second — but it is *pure Ring*, roughly 30 MB/s, not the browser's
native `JSON.parse`. Two practical consequences:

- **Send what the function needs, not the whole response.** Filtering a
  server payload in JavaScript before handing it to Ring is cheaper than
  decoding it twice.
- **A large payload blocks the page while it decodes**, because the VM
  is synchronous. This is the ordinary cost of any synchronous work, but
  it scales with the data, so it is worth knowing before a page hands
  Ring a megabyte on every keystroke.

Untrusted data is safe to pass: malformed JSON raises a catchable Ring
error rather than being accepted, deeply nested input raises a catchable
stack-overflow rather than crashing, and the VM keeps running in both
cases. A permanent gate covers each. The one thing that is *not* safe is
interpolating untrusted text into code you then `eval` — that is true of
every language, and the bridge never does it: the payload reaches Ring
by reference, never through the source.

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

Handles Ring's outbound calls. In Ring, use one of the two high-level
wrappers (they encode the payload and decode the reply for you):

```ring
aReply = Platform(:notify, [ :msg = "saved" ])     # a target capability
see aReply[:ack]                                   # 1

cName  = Page(:getvalue, [ :id = "guest" ])        # this document
```

`Page` and `Platform` are the same seam with two vocabularies, and the
distinction is Softanza's: `Page(…)` touches the document in front of
the user and is web-only by nature, while `Platform(…)` asks for a
capability of the deployment target — storage, notifications, exit —
which is StzWeb's `stz.platform` contract and stays portable across
web, desktop and mobile. Nothing enforces the split; it exists so a
reader can tell portable code from web-only code at a glance. See
[Scripting pages](scripting-pages.md#page-or-platform).

Either way the raw form is `jscall("notify", cJsonString) -> cJsonString`,
when you want to manage JSON yourself. Calls with no registered handler are
dispatched as DOM `CustomEvent`s named `ringscript:<name>` with the
payload in `event.detail` — a zero-coupling way to observe Ring from
elsewhere in the page.

### One rule: a handler must not call Ring back

Your handler runs **while Ring is still running** — it is called from
inside the VM, not after it. The VM is one resident state and cannot run
inside itself, so `ring.eval()`, `ring.call()` and `ring.reset()` are
refused for as long as a handler is on the stack. The refusal is an
ordinary result, `{ ok: false, code: -3, error }`, and the program
already in progress finishes normally and correctly.

```js
ring.on("saved", data => {
    ring.call("Refresh", data);                      // refused, code -3
    queueMicrotask(() => ring.call("Refresh", data)); // runs, after Ring returns
    return { ack: 1 };
});
```

Anything that reaches Ring *after* the handler returns is fine, which is
almost everything real: `fetch(...).then(r => ring.call(...))`, a timer,
an event listener, an `await`. Only the synchronous callback-into-Ring
is refused. `ring.busy()` answers whether the VM is running, if a shared
helper needs to decide for itself.

This is a guard, not a limitation discovered late: without it the outer
program was silently truncated at the callback and still reported
success. See [Architecture](architecture.md#3-design-decisions-worth-knowing).

## ring.reset()

Destroys and recreates the VM — explicitly, never implicitly. All Ring
state is gone; the DOM-seam handlers and your `on()` registrations are
JavaScript-side and survive. Returns `-3` and does nothing if called
from inside a handler: it would delete the state the running VM is
standing on. Use it for "restart program" buttons; the
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
ring.on("name", fn)                // handle Ring's Page/Platform("name", …)
ring.reset()                       // explicit fresh state
ring.busy()                        // true while Ring is running (inside a handler)
```

Inside an `on()` handler the VM is busy: `eval`, `call` and `reset` are
refused (`code: -3`) until the handler returns. Defer with
`queueMicrotask` — see [above](#one-rule-a-handler-must-not-call-ring-back).
