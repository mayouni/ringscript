# Ready-to-paste issues for ring-lang/ring

Four items from [UPSTREAM_CASE.md](../UPSTREAM_CASE.md), split so each
one can be pasted into a fresh GitHub issue on its own. Each file starts
with its **Title**, suggested labels, and whether it is an issue, a
discussion, or an offer; everything below the `---` is the body.

Nothing here has been posted. Posting is yours to do.

| | file | what it is | ready to |
|---|---|---|---|
| 1 | [private + eval crash](issue-1-private-eval-crash.md) | **crash bug**, one-line fix | open issue, then PR |
| 2 | [strtod errno on musl](issue-2-strtod-musl-errno.md) | **portability bug**, one-line fix | open issue, then PR |
| 3 | [string argument copy](discussion-3-string-argument-copy.md) | performance finding, ~5,000× measured | open discussion |
| 4 | [computed-goto](offer-4-computed-goto.md) | implementation of an existing hook | open discussion, offer PR |

## Suggested order

**1 and 2 first.** They are small, self-contained, come with fixes, and
follow the same route as
[ring-lang/ring#1639](https://github.com/ring-lang/ring/pull/1639) —
which is the trust already built. Landing them makes the later two
easier to take seriously.

**3 next, as a discussion, not an issue.** It asks Mahmoud to weigh a
design trade-off (value semantics against O(n²) string handling), and
framing it as a bug would be both wrong and unpersuasive.

**4 last, or alongside 3.** It is an offer of work, not a request for
any, so it costs nothing to leave until there is appetite.

## Every claim is native-verified

Each measurement and reproduction was re-run on stock `ring.exe` 1.27.0
on Windows before being written down — deliberately, so that nothing
can be set aside as a WebAssembly quirk. The wasm numbers appear only
where they are labeled as such (item 4), together with the reason they
are the *weakest* case for that technique.

## If a maintainer asks for more

- **Reproductions**: every snippet in these files runs as-is on stock
  Ring, no RingScript needed.
- **The verification corpus**: `tests/samples-sweep.js` in this
  repository runs Ring's own `samples/` and the documentation snippets
  through both a patched VM and native `ring.exe` and compares
  byte-for-byte.
- **The computed-goto generator**: `tools/regen-computedgoto.py`.
