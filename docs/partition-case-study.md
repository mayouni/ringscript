# The restaurant challenge — how a field failure became a foundation

*The record of one problem's whole journey: met in a real deployment,
decomposed into laws, designed into the runtime's library set, proven by a
harness, and teachable in an afternoon. Companion documents:
[PARTITION-FOUNDATIONS.md](PARTITION-FOUNDATIONS.md) (the design) and the
[Café Tickets tutorial](../samples/cafe-tickets/README.md) (the practice).*

## 1. How we faced it

RestoLean is a point-of-sale platform for neighbourhood food businesses —
browser worlds on the venue's own network: a customer remote control on the
diner's phone, a kitchen display on a tablet, a dashboard for the owner.
Its first field trial ran in **a restaurant in France**, during real
services, with real orders.

On 15 August 2026 a faulty refrigerator kept tripping the circuit breaker.
Each time the internet box rebooted, the DHCP lease changed, and the server
came back at a different address. The feedback tool the owner had been
writing into stored its data in `localStorage` — which browsers partition
**by origin**, scheme + host + port, exactly. When
`http://…10.111:8770` became `http://…10.104:8770`, two hours of his
written observations became unreachable. Not deleted — intact in the
browser profile, under an origin nobody could serve any more.

The owner's response was not a bug report. It was a requirement, from
someone who has run a restaurant through cut cables, building technicians
unplugging the wrong socket, and "plenty of little stories like that":
**the system must stop depending on the network at all, by design.**

Two facts from the follow-up analysis shaped everything after:

- The failure domain everyone talks about — the internet going down — is
  the one a LAN-based system already survives. What actually stops a
  restaurant is **the router and the single server host**, and those fail
  far more often than streets get vandalised.
- A restaurant service is time-boxed and non-recoverable. An order lost at
  12:40 is not delayed revenue; it is gone. And a tool that fails once
  during a rush gets replaced by a paper pad that same afternoon —
  **trust, not features, is the product**.

## 2. How we captured it

The incident was not patched and forgotten; it was **written down as
laws**, each one paid for in the field, and delivered to this repository as
a design kit. The kit's own humility clause — *where the prompt and the
tree disagree, the tree is right* — mattered: reading our tree against it
reframed the task (a durable outbox already existed here) and exposed three
real defects in it that a greenfield design would never have found.

The capture is [PARTITION-FOUNDATIONS.md](PARTITION-FOUNDATIONS.md), five
rulings with every claim traced to a law or a measured fact:

1. **The storage survey, with no exception**: all four browser stores share
   the per-origin bucket; nothing survives a served-origin change. So:
   storage keyed by an explicit **world name**, a named warning state when
   the origin is a bare IP, origin storage restricted to caches and the
   outbox, and a user-visible **file mirror** — a file has no origin.
2. **The outbox contract**: write locally before any network attempt;
   at-least-once, **ordered** replay; the entry id minted on the device as
   the idempotency key; storage-full refused loudly at queue time.
3. **The snapshot/stream contract**: an authoritative snapshot **replaces**
   local caches, never merges; orphans reconciled with a safe exit; a fixed
   five-event order after every reconnection.
4. **The rung**: `alone / streaming / unreachable`, named on screen, never
   a freeze — and **readable from Ring**, because "card payment needs the
   server" is a business rule and business rules live with the rules.
5. **The test story**: the partition is a severed socket, not a mock flag;
   time is injected so the 8-second alarm is asserted, never slept through.

## 3. How it became a foundational feature

The design was executed as **ringscript-pwa 2.0.0** — the runtime's
partition library, in the registry, consumed by three shipped samples. The
three defects the survey found in 1.x are the three headline fixes:
replay was unordered (raced through `Promise.all`) and is now strictly
sequential with stop-at-first-failure; a full store was silent and now
refuses by name; storage was origin-trapped under a pathname key and is
now IndexedDB behind a driver seam, keyed by the world's name, with the
lease-change risk surfaced (`identity.pinned_to_ip`) instead of hidden.

Then the design's own test story was built:
[`tests/partition-harness.js`](../tests/partition-harness.js) drives a real
world on the real VM through a **real TCP proxy whose `sever()` destroys
live sockets mid-stream** — the 15 August failure, reproducible on demand,
twenty checks in 0.7 seconds. Its first run earned its keep immediately:
it caught the reconcile contract eating the device's own undelivered
orders, and forced the rule that now distinguishes a **ghost** (restored
state nothing is carrying) from an **intent** (the device's own work, still
en route). Executing a design teaches what reading it cannot.

## 4. How to use it — the tutorial

[`samples/cafe-tickets/`](../samples/cafe-tickets/) is the practice half:
the smallest application that survives a dead network, and its
[README](../samples/cafe-tickets/README.md) builds it step by step —
about 70 lines of Ring, 120 of JavaScript, one `ringscript add pwa`.
What the app author writes is: the rules, one attach naming the world, one
`send`, and a banner translation. What the app author does **not** write
is everything the restaurant evening taught: durability before
acknowledgement, ordered idempotent replay, the silence alarm, the named
modes, installability, Background Sync.

The division is the lesson, stated once more: the hard parts of surviving
a dead network are the same for every application, so they live in a
library — and what remains for the author is exactly the part that is
theirs, **what the application means**.

## The trail

| artefact | what it is |
|---|---|
| [PARTITION-FOUNDATIONS.md](PARTITION-FOUNDATIONS.md) | the design: survey, contracts, rung, test story, divergences |
| [ringscript-pwa](https://github.com/mayouni/ringscript-pwa) 2.0.0 | the feature, in the registry |
| [`tests/partition-harness.js`](../tests/partition-harness.js) | the outage, reproducible: severed sockets, injected clock |
| [`samples/cafe-tickets/`](../samples/cafe-tickets/) | the tutorial: build it in an afternoon |
| [the blog post](../site/blog-restaurant-challenge.html) | the story, for readers outside this repository |
