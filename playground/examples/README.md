# The Playground examples

One `.ring` file per example. They are ordinary Ring programs — run any of them
with `ring.exe examples/hello-world.ring` — and
[`tests/examples-oracle.js`](../../tests/examples-oracle.js) checks every one
against the native interpreter, byte for byte.

`../examples-data.js` is the manifest: it gives each file its title in the
picker and the answers a `give` should receive. To add an example, drop the
file here and add one line there.

## Where they come from

**12 of these 24 were written by Mahmoud Fayed**, the creator of the Ring
language, for [Try Ring Online](https://github.com/ring-lang/ring/tree/master/tools/tryringonline)
— his own WebAssembly playground for Ring, built on RingQt. They are used here
with thanks. RingScript takes a different route into the browser (the Ring VM
compiled straight to wasm, no Qt), but the samples make the same points, and
starting from a set the Ring community already recognises was the right place
to begin.

The rest were added later, while hardening the runtime, drawn from Ring's own
documentation and sample programs to cover ground the first set did not:
packages, reflection, operator overloading, first-class functions.

| File | Title | Source |
| --- | --- | --- |
| `hello-world.ring` | Hello World | Try Ring Online |
| `print-numbers.ring` | Print Numbers | Try Ring Online |
| `say-hello.ring` | Say Hello | Try Ring Online |
| `sum-two-numbers.ring` | Sum two Numbers | Try Ring Online |
| `using-functions.ring` | Using Functions | Try Ring Online |
| `using-objects.ring` | Using Objects | Try Ring Online |
| `variable-scope.ring` | Variable Scope | Try Ring Online |
| `using-lists.ring` | Using Lists | Try Ring Online |
| `lists-as-hashtables.ring` | Using Lists as HashTables | Ring docs / samples |
| `exit-two-loops.ring` | Exit from Two Loops | Ring docs / samples |
| `using-evals.ring` | Using Evals | Ring docs / samples |
| `change-keywords-arabic.ring` | Change Keywords (Arabic Syntax) | Try Ring Online |
| `call-methods-braces.ring` | Call Methods Using Braces | Ring docs / samples |
| `brace-expr-eval.ring` | Using BraceExprEval | Try Ring Online |
| `natural-commands.ring` | Natural Commands | Try Ring Online |
| `main-menu.ring` | Main Menu | Try Ring Online |
| `functional-map.ring` | Functional: Anonymous Functions & Map | Ring docs / samples |
| `first-class-functions.ring` | First-class Functions | Ring docs / samples |
| `equality-of-functions.ring` | Equality of Functions | Ring docs / samples |
| `operator-overloading.ring` | Operator Overloading | Ring docs / samples |
| `inheritance-super.ring` | Inheritance & Super | Ring docs / samples |
| `private-attributes.ring` | Private Attributes & Methods | Ring docs / samples |
| `packages.ring` | Packages | Ring docs / samples |
| `reflection.ring` | Reflection & Meta-programming | Ring docs / samples |
