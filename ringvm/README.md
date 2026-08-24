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

## If you ever call a Ring function from C

Use `ring_vm_callfuncwithouteval()`. **Never `ring_vm_callfunction()`**,
whose name promises the general-purpose door and whose body is not one:
it opens with `RING_VM_DELETELASTFUNCCALL` (`src/vmeval.c:34`), deleting
the *calling* C function's frame before it loads anything, and closes by
setting `pVM->lActiveCatch = 1` under the comment "Avoid normal steps
after this function, because we deleted the scope in Prepare"
(`src/vmeval.c:44`). It is therefore only safe as the last statement of a
C function that does nothing afterwards. A second Ring call arriving from
the same C function fails with **"Deleting scope while no scope"** — a
message that names nothing about the code that reported it.

`ring_vm_callfuncwithouteval()` saves the PC, runs the function and pushes
the result: no frame deletion, no `lActiveCatch`, and errors raised from C
with `ring_vm_error` stay catchable. It is what Ring itself uses, in this
same vendored copy — `src/vmerror.c:36` for the error handler and
`src/vmoop.c:1402` for method dispatch.

**RingScript does not call Ring from C today** — grep for either symbol
outside `ringvm/` returns nothing — so this is a note for the first time
it does, not a defect. It is written down because microring spent a day on
it twice, from opposite directions, and the reading that unlocks it does
not survive in anyone's head: *"Deleting scope while no scope" means C code
disturbed the scope stack*, never anything about the line that reported it.
Routed here by Central as MICRORING-VMCALLBACK-01, 2026-08-23, and the four
line numbers above were checked in this tree rather than copied.
