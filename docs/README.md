# RingScript documentation

*RingScript **0.9** · Ring 1.27 · built with Zig 0.15.2 — the only
dependency, and only for building. See
[Status and requirements](../readme.md#status--09-and-why-not-10-yet).*

RingScript runs the [Ring](https://ring-lang.github.io/) language inside
the browser: the real Ring 1.27 compiler and VM, compiled to
WebAssembly, kept **resident** so state survives from one evaluation to
the next. These documents take you from "what is this?" to scripting
whole pages in Ring and extending the runtime itself.

**Have Ring installed? Two commands and you are running:**

```bash
ringpm install ringscript from mayouni
ringpm run ringscript          # the Playground opens in your browser
```

Nothing else is required — the package carries the runtime, the
Playground, these documents and a prebuilt web server for your platform.
[Getting started §2](getting-started.md#2-getting-those-two-files) covers
the package CLI (`new`, `preview`, `where`, `version`).

Read them in order — each builds on the previous one:

| # | Document | What you'll learn |
|---|---|---|
| 1 | [Getting started](getting-started.md) | Host two files, run your first Ring code in a page |
| 2 | [Scripting pages in Ring](scripting-pages.md) | Ring instead of JavaScript: `text/ring` blocks, the DOM seam, a complete mini-app |
| 3 | [The JavaScript API](api.md) | Every call and option: `boot`, `load`, `eval`, `call`, `on`, input, errors |
| 4 | [Using and writing libraries](using-libraries.md) | Install one and use it, write your own, test it with no browser, publish it |
| 5 | [Architecture](architecture.md) | How it works inside, the repository layout, building and extending the runtime |
| 6 | [Compatibility & scope](compatibility.md) | What works (verified against native Ring), what's excluded and why, the full-stack picture |
| 7 | [The ZQL payload](zql-payload.md) | The library baked into the wasm: why it is there, and the grammar it accepts |

Worked examples and measurement:

- [Working with data](ledger-app.md) — a real data page written in Ring
  at 20,000 records: what each interaction costs against how fast a page
  has to *feel*, and the four things driving it found (two of them VM
  bugs, now fixed).
- [RingScript vs its peers](rivals.md) — the same scenarios through Lua
  and QuickJS in wasm, so the absolute numbers have context.
- [The headroom plan](HEADROOM_PLAN.md) — where the remaining gaps are,
  traced to root causes, with what each fix actually bought.

Reference material:

- [LIBRARIES.md](LIBRARIES.md) — the library format's specification, and
  why the ecosystem is separate from Ring's.
- [VENDOR_PATCHES.md](VENDOR_PATCHES.md) — the seven deliberate patches
  carried by the vendored Ring source, and why each exists — plus the one
  that was withdrawn, and what replaced it.
- [REPAIR_PLAN.md](REPAIR_PLAN.md) — the original design plan and its
  execution record (August 2026).

To experiment while reading, keep the **Playground** open — double-click
`start-playground.bat` (Windows) or `start-playground.sh` (macOS/Linux)
at the repository root — or run `zig build serve` —
and it opens at <http://localhost:8377/> with 24 editable examples — each one a
plain `.ring` file in [`playground/examples/`](../playground/examples/) that also
runs under `ring.exe`. To add your own, drop the file there and add one line to
`playground/examples-data.js`, which is what fills the picker.
