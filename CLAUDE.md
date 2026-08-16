# RingScript

## Coordination — read before starting work

This repository is one of several worked on in parallel. The coordinating session is
**Central**, in `D:\GitHub\softanza`. It holds the cross-cutting design, the plan, and the
order of work across every repository. It has no authority here and never edits this repo.

**You have a mailbox, and it is how Central talks to you.** There is no message bus here,
but a file change reaches any session holding that file -- so D:\GitHub\softanza\mailbox\<you>.md
is a real channel the moment you open it. Open it first, keep it open, and Central's
appends arrive as messages rather than as something you must remember to check.

**Before starting anything — including when the author says "what is next", and including
when you were about to choose for yourself:**

1. **Open your mailbox** at `D:\GitHub\softanza\mailbox\` -- your repository's name, plus
   your plane if the repository is shared. Read any unanswered block and leave the file
   open for the rest of the session. Format and the reply kinds are in `mailbox/README.md`.
2. Read `D:\GitHub\softanza\protocol\README.md` — scope, how to report, how to disagree.
   It is short.
3. Read `D:\GitHub\softanza\prompts\QUEUE.md` for what is next *for this repository*.
   Regenerate it first if it looks old:
   `powershell -ExecutionPolicy Bypass -File D:\GitHub\softanza\dashboard\central.ps1`
4. Read the last few entries of `D:\GitHub\softanza\dashboard\SESSION-LOG.md` -- what the
   other sessions concluded, which their commits do not say. Opening it also means later
   entries may surface to you as the file changes, which is the closest thing to a message
   from another session that exists here.
5. Pin against the **live versions** the queue prints, never a version number written
   inside a prompt. Where a prompt and this repository disagree, **this repository is
   right** — report the divergence rather than forcing the prompt.

**The queue is a proposal, not an order.** You see local context Central cannot. To
disagree, append a `DISAGREE` block to **your mailbox** with the
**local fact Central could not have known** — a preference is not a DISAGREE. Central
answers there: accept, or insist with a global reason. You then comply or hand it to the
author. Three messages, never a fourth, and you never DISAGREE twice. **If Central does not
answer, proceed and record what you did** — silence is never a veto.

**Report conclusions, not activity.** Central can read what happened here from git; it
cannot read what you *decided*. Append one line to that same log when you commit a plane,
close a phase, decide something another session would otherwise re-decide, or find
something that changes another repository's plan.

**Never edit a sibling repository** — not even a one-line fix. Write it in the log and its
own session makes it.

*This repository: `ringscript`.*
