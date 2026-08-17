# The StzZql pin

RingScript embeds a copy of the ZQL engine — `src/ringlib/stzZql.ring` — under
the grammar's original name, predating the grammar's canonical home. Prompt 11
(`softanza/prompts/11-ringscript-pins.md`) asks this repository to turn that
embedding into a **pinned consumption**: version recorded, fixtures as the
gate, rather than two projects quietly carrying "the same" file with no
contract saying so.

## The pin

| | |
|---|---|
| Grammar home | [`stzzql`](https://github.com/mayouni/stzzql) — "tontine conformance fixtures v1" |
| Fixtures pinned | `conformance/fixtures.json`, sha256 `3aabc8ef447c1adfaabfed68e59c490a9abdcf38af680b7860c08ca943545559` |
| Grammar spec pinned | `GRAMMAR.md`, sha256 `89b1b47ff7ee853d081d404a1ceb778dedf858384f2497de5e386eed8dbfb420` |
| StzZql at pin time | commit `2223c40` |
| Reference Ring runtime | Zing `runtime/ring/zql.ring`, commit `f9816af`, sha256 `4a4e69f9fb869bc03d00b1468050343814082546cec34247ca96ae8cb41e98d9` |
| Embedded copy here | `src/ringlib/stzZql.ring`, sha256 `b6f11b6adf1c6477b1ab481941bd08d4213cd3654e265529d276872a11312978` |
| Conformance result | **20 / 20 checks agree** — all 16 fixture verdicts (4 norm, 8 flow, 4 rejects) plus the 4 declaration counts |
| Verified | 2026-08-17, `ring src/ringlib/stzzql_conformance.ring` against `D:\ring127\bin\ring.exe` |

**The engine behaves exactly as the canonical grammar specifies.** Every norm
evaluation, every flow outcome (including the `FORMULA`/`COUNT`/`SUM`/`ROUND`
arithmetic and the SAISIE-step refusal on an empty survey), and every reject
of a closed-verb-set violation matches the fixture file byte for byte in
verdict.

## How the pin is checked

```bash
ring src/ringlib/stzzql_conformance.ring
```

`stzzql_conformance.ring` transcribes the fixture source, case data and
expected verdicts from `conformance/fixtures.json` by hand rather than
parsing JSON at runtime — the engine it tests is deliberately pure core Ring
with no dependency, and the runner follows the same discipline. **When
`fixtures.json` changes upstream, this file is re-transcribed by hand; that
manual step is what "re-pinning" means here.** `stzzql_smoke.ring` beside it
is the older, smaller hand-written check kept for a quick sanity run; the
conformance runner is the one that proves agreement with the canonical file
rather than asserting a programmer's own expectations of it.

## Drift found, and why it does not block the pin

Byte comparison against Zing's `runtime/ring/zql.ring` (the reference Ring
runtime) finds a real difference, confined to `Describe()` and two error
messages — none of it exercised by any fixture:

- **The embedded copy prints landing zones in `Describe()`; the reference
  runtime does not.** RingScript added this on 2026-08-03
  ([`da55420`](https://github.com/mayouni/ringscript/commit/da55420)) after finding `Describe()` silently
  omitted a declared zone. The fix was made here and was never carried back.
- **The embedded copy drops the `:` sigil from `Describe()` output and from
  two "no such norm/flow" error messages; the reference runtime still emits
  it.** Also `da55420`'s neighbor,
  [`d2dedcd`](https://github.com/mayouni/ringscript/commit/d2dedcd), same date, same reasoning: the sigil is a
  ZQL declaration-site marker, not something a *read-back* of a declaration
  or an error about one should need.

**Neither difference touches parsing, evaluation, or flow semantics** —
`Describe()` is a developer-facing dump, not part of the grammar's
observable behavior, and the fixture file does not exercise it. So this is
drift in the sense the prompt asked to watch for, but not disagreement about
what the grammar *means*: RingScript's copy is not behind, it is ahead in
these two spots and the reference runtime has not caught up.

**Not silently re-vendored, per the prompt's instruction.** Reported instead
to Softanza Central's mailbox and session log, since neither `stzzql` nor
`zing` is this repository's to edit — whether to port the two fixes back is
a decision for whichever session owns them.

## What this repository will not do

Re-vendor on drift discovered here. A pin that resolves its own disagreements
is not a pin. When the grammar changes upstream, the embedded copy is
updated deliberately, the conformance runner is re-transcribed, and this
document's table is rewritten with the new hashes.
