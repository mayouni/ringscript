# Alignment — RingScript against the Softanza reference design

**Reference**: `softanza/REFERENCE_DESIGN.md` v0.1 (draft, unratified) · 2026-08-08
**Status**: obligations-if-ratified. Written from outside; this repository's own
process decides.

## Where RingScript sits in the reference design

The browser placement — and the family's proof that the pattern works: the one Ring leg
that shipped (0.9), consumed by Zing as a versioned, recorded artifact. The reference
design asks almost nothing of it, which is what shipped and stable earns.

## What changes here

1. **StzZql, by pin (decision 6.1).** RingScript embeds `stzZql`; when the grammar gets
   its canonical home, that embedding becomes a pinned consumption — version recorded,
   fixtures as the gate — closing the lineage ambiguity in which two projects embed
   "the same" file with no contract saying so.
2. **C3, one row.** The browser placement (`:local` in topology terms) is described
   once in the Placement Contract; RingScript reviews that row for accuracy — its
   resident-VM semantics (state survives navigation? memory model?) are what the row
   must not misstate.

## What must not change

The 0.9 artifact discipline, the two-way JSON bridge, the release-versioned consumption
model — it is the template the rest of the family is being aligned *to*.

## Talking to the Ring project

RingScript **finds and reports; it does not send.** Anything discovered about the Ring
VM — a bug, a quadratic, a trap — goes to **RingUpstream**, which establishes whether it
is real and new, drafts the text, and hands it to Mansour. He chooses the channel and
posts it himself.

This is not a style preference. `ring-lang/ring` has issues and discussions disabled and
much of the history lives in a Google Group that cannot be searched without a login, so a
clean GitHub search does not mean a finding is new. On 2026-08-14 this repository sent one
that had already been raised there.

What stays here: the vendored VM, its patches, and the note in
[docs/VENDOR_PATCHES.md](docs/VENDOR_PATCHES.md) listing upstream fixes to pick up at the
next vendor swap.

## Honest boundaries

Two obligations, both small, both downstream of decisions made elsewhere. If the StzZql
extraction changes the embedded artifact's name or shape, RingScript's cost is a
re-vendor and a version note, and the reference design owes it that warning in advance.
