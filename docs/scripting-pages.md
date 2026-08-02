# Scripting pages in Ring

*Goal of this page: a complete interactive page whose logic is 100%
Ring — no JavaScript written by you.*

This is the second document; it assumes you have seen
[Getting started](getting-started.md).

## 1. The idea

A web page has three concerns: structure (HTML), presentation (CSS) and
behavior. Browsers only run JavaScript and WebAssembly for behavior —
so RingScript puts a Ring VM *in* the page and gives it two small
doors:

- **inbound** — page controls call Ring functions:
  `onclick="ring.call('MyFunc')"`;
- **outbound** — Ring reads and writes the page through one function:
  `Platform(name, data)`.

Everything else — the state, the rules, the decisions — is ordinary
Ring, written in a `<script type="text/ring">` block.

## 2. A complete mini-app

This page greets a visitor and counts clicks. It is real — the same
source runs in this repository's Playground examples:

```html
<script src="ringscript.js"></script>
<script>RingScript.boot()</script>

<input id="guest" placeholder="Your name">
<button onclick="ring.call('Greet')">Greet</button>
<button onclick="ring.call('AddOne')">+1</button>
<div id="hello"></div>
<div id="n"></div>

<script type="text/ring">
nClicks = 0

func Greet aEv
    cName = Platform(:getvalue, [ :id = "guest" ])
    if cName = "" cName = "stranger" ok
    Platform(:settext, [ :id = "hello",
        :text = "Ahlan, " + cName + "!" ])

func AddOne aEv
    nClicks++
    Platform(:settext, [ :id = "n",
        :text = "clicked " + nClicks + " times" ])
</script>
```

Walk through what happens when the user clicks **Greet**:

1. The button's `onclick` runs `ring.call('Greet')` — `window.ring` was
   exposed by `boot()`.
2. The VM calls the Ring function `Greet`. Functions invoked through
   `ring.call` always receive **exactly one argument** (the JSON
   payload, `NULL` when none was passed) — that's why the signature is
   `func Greet aEv` even though this caller sends nothing.
3. `Platform(:getvalue, [ :id = "guest" ])` crosses to JavaScript,
   reads the input's value, and returns it to Ring as a string.
4. Ring logic decides what to say — plain `if`, plain string
   concatenation.
5. `Platform(:settext, …)` writes the greeting into the `div`.

Note what you did **not** write: no `addEventListener`, no
`document.getElementById`, no state management. And note where the
state lives: `nClicks` is a Ring global in the resident VM, surviving
between clicks.

## 3. The DOM seam, precisely

`boot()` registers three handlers; Ring reaches them through
`Platform(name, data)` where `data` is a Ring **pair-list**
(`[ :key = value, … ]` — RingScript's standard JSON mapping, see
[the API doc](api.md#json-mapping)):

| From Ring | Effect | Returns |
|---|---|---|
| `Platform(:settext,  [ :id = "x", :text = v ])` | sets the element's text content | `1` |
| `Platform(:gettext,  [ :id = "x" ])` | — | the element's text |
| `Platform(:getvalue, [ :id = "x" ])` | — | the input's value |

Three handlers are deliberately few: they cover the read/write/display
loop of a form-like page while keeping the seam auditable. When you
need more — toggling classes, fetching JSON, navigating — register your
own in one line of JavaScript each:

```html
<script>
RingScript.boot().then(ring => {
    ring.on("addclass", p => {
        document.getElementById(p.id).classList.add(p.cls);
        return 1;
    });
});
</script>
```

```ring
Platform(:addclass, [ :id = "hello", :cls = "highlight" ])
```

The contract is symmetrical and JSON-shaped in both directions: the
pair-list you pass becomes the handler's object argument; whatever the
handler returns comes back as the Ring value of the `Platform(...)`
call.

## 4. Design guidance

- **Keep the seam thin.** Handlers should move data, not contain
  logic. If an `if` is creeping into a handler, it probably belongs in
  Ring.
- **One `text/ring` block per concern** is fine — `boot()` runs all of
  them in document order, into the same resident VM, so later blocks
  see earlier definitions.
- **Keep Ring in `.ring` files** once a page grows past a few lines.
  A block may carry a `src`, so the tags read like a list of `load`
  lines and the files stay plain Ring that still runs under `ring.exe`:

  ```html
  <script type="text/ring" src="helpers.ring"></script>
  <script type="text/ring" src="invoice.ring"></script>
  <script type="text/ring">? Greet("Mansour")</script>
  ```

  Note this is *not* Ring's `load`, which cannot work in a browser:
  there is no filesystem for it to search, so `load "helpers.ring"`
  reports `Error (E9) : Can't open file helpers.ring`. The `src`
  attribute is the browser's equivalent — the file arrives over HTTP,
  which also means the page must be served over `http(s)://` rather
  than opened as `file://`.
- **Interactive input works too**: a Ring program that uses `give`
  pauses on a browser prompt showing the program's own question. For
  form-like pages prefer `Platform(:getvalue, …)` — prompts suit
  console-style programs (see them in the Playground).
- **Errors never take the page down.** A failing Ring function reports
  (with its real line number) and the VM — with all state — survives.
  Check `r.error` in JavaScript, or just watch the console.

## 5. Where this pattern shines

Business rules that change more often than the page around them;
teaching pages where the visible logic *is* the lesson; and — the
origin of this project — the [StzWeb](compatibility.md#part-of-the-softanza-project)
framework, where the same declaration can be evaluated by StzWeb's
JavaScript runtime and by Ring-on-wasm side by side, with identical
verdicts.
