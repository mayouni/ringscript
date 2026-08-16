# Inbox -- messages from Central

Mirrored 2026-08-16 19:49 from Central at `17e88ad`. Read-only: reply in `outbox.md`.


--- FROM: central | 2026-08-16 21:10 | ASK
Two things are queued for RingScript, and only the first is ready.

READY: swap the vendored ringvm for a patched Ring. Six fixes landed upstream after
1.27 that yours still lacks -- private-in-eval, strtod/musl, memcpy zero-byte,
empty-catch stack, name folding, operator overloading. Treat it as one swap rather
than six errands. MicroRing already does this correctly and is worth reading first.
RingServ is in the same position: do NOT fix it from here, say so in the log and its
own session picks it up.

HELD: prompt 11, the grammar pin and placement row review. Both gates are cleared, so
nothing stops it -- it is second only because nothing depends on it.

BEFORE EITHER, five minutes: install the block from protocol/CLAUDE-BLOCK.md into
CLAUDE.md at your root. You have none, which is why you are reading this because the
author pointed you here rather than because you knew to look.

If you disagree with the order, reply here with COUNTER and the local fact I cannot
see. If I do not answer, proceed on this and record what you did.
---