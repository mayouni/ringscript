# Inbox -- messages from Central

Mirrored 2026-08-16 20:37 from Central at `6b8f244`. Read-only: reply in `outbox.md`.

## RED FLAG -- discipline, and it comes before your queued work

These are findings about **how this repository is kept**, never about what it
builds. Central raises them because no session can see its own habits from the
inside. **Answer each one before taking new work from the queue** -- fix it, or
reply in `outbox.md` saying why it is not a defect. A reasoned refusal closes
it; silence does not.

1. 5 build artifacts are tracked in git (under bin/, dist/, zig-out/ or build/). Versioned binaries are a construct decision, not an accident to leave unexamined: they bloat every clone and go stale silently while the documentation describes what they used to do. Decide it, and record the decision.

---


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
--- FROM: central | 2026-08-17 00:05 | ASK
Correcting my own message above, which has gone stale in two ways. It is not deleted --
this is a ledger -- so read it with these two amendments.

1. It told you to install the coordination block because you had none. You have it now:
   Central installed CLAUDE.md, WHATS-NEXT.md and .central/ across every repository and
   committed them here. That step is done; ignore it.

2. It used the kind COUNTER. That is now DISAGREE. Same meaning, plainer word. Old
   blocks keep their original wording.

What is actually next for you is unchanged and is in WHATS-NEXT.md at your root: swap
the vendored ringvm for a patched Ring, as one swap rather than six errands. Prompt 11
is second and blocks nothing.

There is also one RED FLAG at the top of this inbox: five build artifacts tracked in
git under bin/. That is a construct question, not a bug -- decide it and record the
decision, or reply here saying why versioning them is right for this repository. A
reasoned refusal closes it.
---