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

## Honest boundaries

Two obligations, both small, both downstream of decisions made elsewhere. If the StzZql
extraction changes the embedded artifact's name or shape, RingScript's cost is a
re-vendor and a version note, and the reference design owes it that warning in advance.
