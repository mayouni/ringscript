# RingScript documentation

*RingScript **0.9** · Ring 1.27 · built with Zig 0.15.2 — the only
dependency, and only for building. See
[Status and requirements](../readme.md#status--09-and-why-not-10-yet).*

RingScript runs the [Ring](https://ring-lang.github.io/) language inside
the browser: the real Ring 1.27 compiler and VM, compiled to
WebAssembly, kept **resident** so state survives from one evaluation to
the next. These documents take you from "what is this?" to scripting
whole pages in Ring and extending the runtime itself.

Read them in order — each builds on the previous one:

| # | Document | What you'll learn |
|---|---|---|
| 1 | [Getting started](getting-started.md) | Host two files, run your first Ring code in a page |
| 2 | [Scripting pages in Ring](scripting-pages.md) | Ring instead of JavaScript: `text/ring` blocks, the DOM seam, a complete mini-app |
| 3 | [The JavaScript API](api.md) | Every call and option: `boot`, `load`, `eval`, `call`, `on`, input, errors |
| 4 | [Architecture](architecture.md) | How it works inside, the repository layout, building and extending the runtime |
| 5 | [Compatibility & scope](compatibility.md) | What works (verified against native Ring), what's excluded and why, the full-stack picture |

Reference material:

- [VENDOR_PATCHES.md](VENDOR_PATCHES.md) — the four deliberate patches
  carried by the vendored Ring source, and why each exists.
- [REPAIR_PLAN.md](REPAIR_PLAN.md) — the original design plan and its
  execution record (August 2026).

To experiment while reading, keep the **Playground** open — double-click
`start-playground.bat` (Windows) or `start-playground.sh` (macOS/Linux)
at the repository root — or run `zig build serve` —
and it opens at <http://localhost:8377/> with 24 editable examples.
