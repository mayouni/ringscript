# Vendored Ring VM source

This is the Ring compiler + VM source (`src/`, `include/`), trimmed to
exactly what the wasm build compiles — the platform build scripts, native
test suite and visual source of the upstream tree are not vendored (see the
[Ring repository](https://github.com/ring-lang/ring) for the full tree).

**The base is Ring master at `8a89cc00c2`, taken 2026-08-16.** Measured
against the stock 1.27 distribution that is 91 changed lines across 12 `.c`
files and 2 headers, every one of them a fix and none of them a feature —
so this reports itself as **1.27**, which is a deliberate patch and not an
oversight.

It carries four RingScript patches, each marked with a `RINGSCRIPT PATCH`
comment at the site and documented in
[docs/VENDOR_PATCHES.md](../docs/VENDOR_PATCHES.md). **Re-apply them when
swapping in a new Ring version** — `node tests/gates.js` fails loudly if any
of the line-number ones is missing, and `node tests/samples-sweep.js` is the
real gate: a byte-exact comparison against the native interpreter.

That document also has a short recipe for doing the swap, written down
because the hard part turned out not to be applying the patches. It was
noticing which ones upstream had already made unnecessary.
