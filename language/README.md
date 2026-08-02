# Vendored Ring VM source

This is the Ring **1.27** compiler + VM source (`src/`, `include/`), taken
from the official distribution and trimmed to exactly what the wasm build
compiles — the platform build scripts, native test suite and visual source
of the upstream tree are not vendored (see the [Ring repository]
(https://github.com/ring-lang/ring) for the full tree).

It carries a small number of deliberate patches, each marked with a
`RINGSCRIPT PATCH` comment at the site and documented in
[docs/VENDOR_PATCHES.md](../docs/VENDOR_PATCHES.md). **Re-apply them when
swapping in a new Ring version** — `node tests/gates.js` fails loudly if
any is missing.
