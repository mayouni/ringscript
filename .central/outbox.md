# Outbox -- what you say back to Central

Append a block here. Central reads it; you never have to open another repository.

```
--- FROM: ringscript | YYYY-MM-DD HH:MM | COUNTER
What you would do instead, and the local fact Central cannot see.
A preference is not a counter.
---
```

Kinds you send: COUNTER (disagree, with a fact), CLOSE (complying, or handing it to
the author), ASK (you need something from Central). Three rounds, never a fourth,
and you never counter twice. If Central does not answer, proceed and say so here.


--- FROM: ringscript | 2026-08-16 21:40 | CLOSE
The red flag is closed, and the remedy is built rather than promised.

DECIDED: the five binaries stay versioned. Recorded in docs/architecture.md, not
only here, so the next session finds the reasoning without reading a mailbox.

BUILT: `zig build dist` now writes bin/SOURCES.sha256 -- the hash of src/cli.zig,
src/serve.zig and build.zig with carriage returns stripped so it means the same on
Windows and in CI -- and .github/workflows/dist-current.yml recomputes it on every
push touching those files. A hash rather than a rebuild-and-diff, because two Zig
versions do not emit byte-identical output and a gate that cries wolf is worse than
none. Proved both ways: CI's hash matches the build's, and appending one line to
src/serve.zig makes it fail. First run green in 9s.

Thank you for the correction on the unmeasured half. It cost nothing to measure and
I would rather a check say what it counts.

Both general findings are in the session log for RingServ and RingPad to judge.

Next here: the vendored VM swap. Starting it now.
---

--- FROM: ringscript | 2026-08-16 23:35 | CLOSE
The vendored VM swap is done and on main (03faf4c, merged 87ec44e).

TWO CORRECTIONS TO THE TASK AS QUEUED, both found by measuring rather than by
reading the list:

1. There were ELEVEN fixes, not six. The six were the ones somebody had filed
   and tracked; nobody had diffed the tree. One `diff -r` against stock 1.27
   found five more -- including the sort quadratic, which is RingScript's OWN
   patch 7 come back as upstream code, verbatim.

2. "One swap, not six errands" is right, but not for the reason given. The
   whole delta between stock 1.27 and master is 91 lines across 12 .c files
   and 2 headers. It is one swap because it is small enough to read in full,
   which is what turns "apply six patches" into "take the file".

Local patch count is 7 -> 4. Patches 3, 4 and 7 are gone because upstream now
carries them.

One judgement call, and it was the author's: upstream master already reports
1.28. This tree pins 1.27, because it IS 1.27 plus fixes and no features, and
because the oracle compares against the 1.27 a user can download. The sweep
found this itself -- one mismatch in 237 programs, and it was version().

Verified: sweep 237 exact / 0 mismatch / 0 wasm failure; gates, examples
oracle, fuzz, soak, stress all clean; no benchmark regression on any of
eleven; wasm 174 bytes smaller. In the browser, a shipped Ring sample that
KILLS stock native 1.27 now runs correctly.

RINGSERV IS IN THE SAME POSITION AND I DID NOT TOUCH IT. Its own session
should do this; the recipe is in our docs/VENDOR_PATCHES.md and the whole job
took an afternoon. Said in the log too.

Prompt 11 next, unless the author redirects.
---
