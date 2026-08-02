# Getting started

*Goal of this page: in five minutes, a web page of yours runs Ring code.*

## 1. What you are deploying — and what you are not

RingScript is **two static files**. There is no toolchain, no bundler,
no npm, no server-side component. You copy them next to your HTML and
any static host (GitHub Pages, nginx, S3, a shared PHP host…) serves
them like any other asset:

```
your-site/
├── index.html
├── ringscript.js      the loader — a classic script, ~12 KB
└── ringscript.wasm    the Ring VM — the real compiler + VM, ~340 KB
```

Both files live in this repository under `playground/`. (Building them from
source with Zig is covered in [Architecture](architecture.md) — it only
concerns you if you want to change the runtime itself.)

> **Why a wasm file?** Browsers execute two things natively: JavaScript
> and WebAssembly. RingScript compiles Ring's own C source to
> WebAssembly, so what runs in the page is not an imitation or a
> transpiler — it is the same VM that runs `ring.exe`, byte-for-byte
> verified against it (see [Compatibility](compatibility.md)).

## 2. Getting those two files

Either **download them** from the repository's `playground/` folder, or
— if Ring is on your machine — let **RingPM** fetch them for you.

### With RingPM (nothing else required)

```bash
ringpm install ringscript from mayouni
```

That's the whole prerequisite list: **Ring**. Not Zig, not Node, not a
build step. Besides the two runtime files, the package brings the
Playground, this documentation, and a **prebuilt static web server for
your platform** (~40 KB — RingPM downloads only yours).

```bash
ringpm run ringscript          # serves the Playground, opens your browser
```

The package also carries a small CLI. Run it from the package folder, or
by absolute path from your own project directory — it locates itself
either way, and `new` scaffolds where **you** are:

| Command | What it does |
|---|---|
| `ring main.ring serve [port]` | serve the Playground (default port 8377) |
| `ring main.ring new <folder>` | scaffold a page already scripted in Ring, with both runtime files beside it |
| `ring main.ring preview <folder> [port]` | serve a folder you made, and open it |
| `ring main.ring where` | print the full paths of the two files to copy |
| `ring main.ring version` | `RingScript 0.9 (Ring 1.27)` |

From your own Ring code, `lib.ring` exposes the same operations —
`RingScriptServe()`, `RingScriptNew(cHome, cFolder)`,
`RingScriptPreview(cHome, cFolder, nPort)`,
`RingScriptRuntimeFiles(cHome)`.

The fastest path from install to a running page of your own:

```bash
ringpm install ringscript from mayouni
cd my-project
ring <package folder>/main.ring new mysite
ring <package folder>/main.ring preview mysite
```

### By hand

Copy `ringscript.js` and `ringscript.wasm` out of `playground/` into your
site folder. Nothing else is needed — the rest of this guide assumes only
those two files.

## 3. The smallest possible page

Create `index.html` next to the two files:

```html
<!DOCTYPE html>
<html>
<body>
    <script src="ringscript.js"></script>
    <script>RingScript.boot()</script>

    <script type="text/ring">
    see "Hello from Ring " + version() + nl
    for i = 1 to 3
        ? "tick " + i
    next
    </script>
</body>
</html>
```

Open it **over HTTP** (browsers refuse to fetch wasm from `file://`;
any static server works) and open the browser console: the Ring output
is there.

Three things just happened, and each is worth understanding:

1. `ringscript.js` defined one global, `RingScript`, with two entry
   points: `boot()` and `load()`.
2. `RingScript.boot()` fetched the wasm, created **one resident Ring
   VM** for the page, and ran every `<script type="text/ring">` block in
   document order. Browsers ignore script tags whose type they don't
   know — which is exactly why this pattern works: the blocks are inert
   until the loader picks them up.
3. Your Ring code ran on the real thing: `version()` printed `1.27`
   because that is the vendored Ring version.

## 4. "Resident" is the important word

The VM created by `boot()` does not die after your script block ends.
It stays alive for the lifetime of the page, and everything you defined
— globals, functions, classes — remains available. That is what turns
Ring from a curiosity into a *scripting language for the page*: a
button clicked two minutes later can call a function your `text/ring`
block defined at load time.

You can feel this in the [Playground](../playground/index.html) (or by
double-clicking `start-playground.bat` / `start-playground.sh`): run `x = 5` — then, as a
second run, `see x`. The `5` is still there.

## 5. Where output goes

Ring's output statements — `see`, `?`, `put`, and even the C-level
`print()` — are captured by the runtime in order. In `boot()` mode they
end up in the browser console. When you drive the VM programmatically
(next section of the docs), each evaluation hands you its output as a
string, which you can put wherever you want — a `<pre>`, a terminal
widget, a log.

## 6. Where to go from here

- You want Ring to *react to the page* — buttons, inputs, dynamic text:
  read [Scripting pages in Ring](scripting-pages.md).
- You want to drive the VM from existing JavaScript — evaluate code,
  call Ring functions with JSON, subscribe to events: read
  [The JavaScript API](api.md).
- You wonder what will and won't work inside the browser: read
  [Compatibility & scope](compatibility.md).
