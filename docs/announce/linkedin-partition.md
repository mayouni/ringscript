# LinkedIn post — the restaurant challenge

Best posted **with two images**: the Café Tickets app mid-outage (the
amber "Till unreachable" banner visible, tickets still being taken), and
optionally the harness output ("All partition checks passed. 0.7 s wall").
The screenshot carries the proof; the words frame it.

---

A refrigerator taught our runtime partition tolerance.

During a field trial of RestoLean — our point-of-sale platform — in a
restaurant in France, a faulty fridge kept tripping the circuit breaker.
Every reboot of the internet box changed the server's address. And because
browsers bind storage to the *origin* — the address, exactly — hours of
the owner's work became unreachable. Not deleted. Worse: intact, behind an
address that no longer existed.

The owner didn't file a bug. He stated a requirement: "A single cut can
wreck an entire service. The system must stop depending on the network at
all — by design."

So that evening became engineering, end to end:

📋 **Captured as laws** — seven of them, each paid for in the field. Write
locally before any network attempt. A server snapshot replaces local
state, never merges. Distinguish a blip from an outage — an alarm that
cries every minute trains people to ignore the one that matters.

📦 **Built as a foundation** — the laws became ringscript-pwa 2.0, the
partition library of our RingScript runtime (Ring compiled to
WebAssembly). Orders queue durably *before* they're acknowledged. Replay
is ordered and idempotent — an id minted on the device means a retry can
never become a duplicate. The degraded mode has a *name* on screen, never
a frozen spinner. And storage is keyed by the app's name, never its
address — the exact trap that started all this.

🧪 **Tested like the real thing** — the harness reproduces that evening on
demand: a real TCP proxy severs live sockets mid-stream, and twenty
assertions run in 0.7 seconds. Its first run caught a design flaw the
document couldn't see. Executing a design teaches what reading it cannot.

☕ **Teachable in an afternoon** — the tutorial app is a café ticket pad:
70 lines of Ring. The only rule that mentions the network is the one that
should — a cancellation touches the till, so it politely refuses until
the till is back. Then you cut the connection and try to break it.

The lesson we'd give any team: the hard parts of surviving a dead network
are the same for every application. Put them in a library, test them by
cutting real sockets, and leave app developers exactly one job — deciding
what their application means.

Story, design doc, tutorial: link in the first comment.

#LocalFirst #OfflineFirst #ResilientSystems #WebAssembly #RingLang
#RingScript #PWA #PointOfSale #SoftwareEngineering

---

**First comment** (links travel better there than in the post):

The full story: https://mayouni.github.io/ringscript/blog-restaurant-challenge.html
The tutorial (break it yourself): https://github.com/mayouni/ringscript/blob/main/samples/cafe-tickets/README.md
The design, every ruling traced to a law or a measurement: https://github.com/mayouni/ringscript/blob/main/docs/PARTITION-FOUNDATIONS.md
