# Client-plane foundations for partition tolerance

**Status**: design, 2026-08-19 — answers the RestoLean kit
(`restolean/livrable/makeen/KIT-RINGSCRIPT-ARTICLE.md`) and its companion prompt.
Laws cited as *Law N* are the article's; *P/D/L* codes are the brief's
(`NETWORK-RESILIENCE-BRIEF.md`); facts cited as `file:line` are this tree's, read
and where possible executed, not assumed.

**The one correction to the prompt before anything else** (full list in §6): the
durable outbox it asks for as "the one thing the JS prototype never achieved" is
**already shipped here** — `ringscript-pwa` 1.1.0, published in the registry
2026-08-16, wired into two samples and their test harnesses. Item 2 is therefore a
*v2 of a real library with three measured defects*, not a first design. That is
better news than greenfield: the API below is a delta against code that runs, and
every claim about v1 has a file and line.

---

## 1. The storage survey, against the origin-as-fault-domain law

### 1.1 What the browser offers a Wasm world

The wasm VM itself offers **nothing durable, by construction** — no filesystem
([architecture.md §3](architecture.md): every `fopen` resolves against the embedded
read-only map), no network. Everything durable a RingScript world has lives in the
page's JavaScript, which means the browser's four stores:

| | localStorage | IndexedDB | OPFS | Cache API |
|---|---|---|---|---|
| **Origin binding** | scheme+host+port, exact | same | same | same |
| **Sync/async** | sync | async | async (sync handles in workers) | async |
| **Quota** | ~5 MB | large — a share of the origin's storage-bucket quota | same bucket | same bucket |
| **Readable from a service worker** | **no** | yes | yes | yes |
| **Eviction** | best-effort bucket: evictable under storage pressure unless `navigator.storage.persist()` is granted; Safari additionally caps script-writable storage for non-installed pages | same bucket, same rule | same | same |
| **Survives a served-origin change** | **no** | **no** | **no** | **no** |

The last row is the finding, and it has no exception: all four stores live in the
same per-origin bucket. When `http://192.168.10.111:8770` becomes
`http://192.168.10.104:8770`, *every one of them* presents as empty. The old data
is not deleted — it sits intact in the browser profile under the old origin,
unreachable until a page is served **from that exact origin** again, which after a
DHCP lease change may be never. Moving from localStorage to IndexedDB, or to OPFS,
changes quota and ergonomics and changes the 15 August failure **not at all**.

Two things escape the table because they have no origin:

- **A user-visible file** (File System Access API where present — Chromium,
  including the Android tablets the kitchen display runs on; download/share
  fallback elsewhere, iOS Safari included). A file survives every lease, every
  origin, every browser profile decision. This is exactly the remediation the
  prototype reached for the Carnet (Law's founding incident, article §2): the
  instrument stopped sharing fault domains with the thing it measures.
- **The server**, once an outbox entry has been delivered.

### 1.2 Where this tree stands today — the measured fact

`ringscript-pwa`'s queue persists through `localStorage` under a **pathname** key:

```js
var storageKey = opts.storageKey || ("ringscript.pwa." + location.pathname);   // pwa.js:52
```

A pathname key *inside* an origin-bound store: the library carries the 15 August
trap as its default. The service-worker handover (`pwa.js:84-92`) additionally
round-trips pending payloads through the Cache API solely because a worker cannot
read localStorage — a workaround IndexedDB removes outright.

### 1.3 The ruling

**R1 — The default durable store is IndexedDB, behind the library's seam.** World
authors never touch it; they call `queue()` and `snapshot()`/`restore()` as today.
Gains over v1: the service worker reads the outbox directly (the `publish()`
handover hack is deleted), the quota is no longer 5 MB, and writes are async off
the interaction path. localStorage remains a legal backend for tiny worlds; the
seam hides which one is under the world.

**R2 — Origin-pinning becomes explicit, visible, and named.** At attach, the
library computes a **storage identity** and exposes it:

```
pwa.identity  ->  { world: "cousbox-remote",     // author-declared, MANDATORY in v2
                    origin: "http://makeen.local:8770",
                    pinned_to_ip: false,          // location.hostname is an IP literal?
                    persisted: true }             // navigator.storage.persist() granted?
```

- `world` is a new mandatory attach option: the storage key becomes
  `world`-derived, never `location.pathname`-derived. Renaming a file or serving
  the same world at a different path stops silently forking its storage.
- `pinned_to_ip: true` raises the named banner state **`STORAGE-PINNED-TO-ADDRESS`**
  (§4's surface): the world is being served from a bare IP, so its storage dies
  with the DHCP lease. The fix is operational and stated in the banner text: serve
  from a stable name (Makeen's mDNS name or a static host), not an address. The
  runtime cannot make an IP origin survivable; it can refuse to let one be silent.
- `persisted: false` after a `persist()` request means the bucket is evictable
  under pressure; the world can surface that too.

**R3 — The doctrine that makes origin storage safe to lose.** Origin storage may
hold exactly two kinds of thing: **(a) replaceable caches of server truth** and
**(b) the outbox — data en route to the server**. Data whose *only* copy is origin
storage is a design defect, and the 15 August incident is precisely that defect:
notes whose only home was a lease-bound origin. Under R3 the loss of an origin
bucket costs a re-sync (caches) plus whatever the outbox had not delivered — which
R4 closes.

**R4 — The file mirror, for the outbox's residual risk and the Carnet class.** A
new library primitive: an explicit, user-visible file that mirrors the outbox (and
optionally world state) on every save. File System Access API where present; a
one-tap "download the journal" fallback elsewhere. Two hours of writing against an
unreachable server is then: entries in the outbox (R3-b), mirrored in a file that
has no origin (R4). A lease change loses **nothing** — the acceptance test the kit
set. Worlds of the writing-instrument class (authoring, notes, observation — the
Carnet) should treat the mirror as their primary store and the origin bucket as
cache only, which is the article's own remediation stated as a library feature.

## 2. The durable outbox, as a runtime primitive

### 2.1 What already exists, with evidence

`ringscript-pwa` 1.1.0 (its own repo + registry; consumed by `samples/route-orders`
and `samples/stock-count`; exercised by `tests/orders-app.js` and
`tests/stock-count-app.js`):

- **Write locally before any network attempt** (Law 1): `queue()` calls
  `PwaOutboxAdd` and `save()` before any send is even scheduled (`pwa.js:97-102`).
- **The id is made on the device, before anything is sent** — `pwa.ring:56-58`
  builds `kind-device-seq-clock` at add time, so a retry after a dropped
  connection is a *retry*, not a second order.
- **Replay on reconnection**: retries on the `online` event, on demand, and via
  Background Sync when the tab is gone (`sw-pwa.js:82-104`).
- **Rollback**: a failed send returns the entry to `queued` (`pwa.js:127-129`);
  a failed *batch request* rolls the whole batch back (`pwa.js:154-159`), and the
  distinction — request never arrived vs. server answered per entry — is the
  library's, not the world's.
- **Visible pending state** (Law 1's second half): `pending()`, `list()`, and an
  `onChange` hook both samples use to render a queue counter.

### 2.2 The three measured defects v2 exists to fix

1. **`flush()` is unordered.** `flushOnce` maps pending entries through
   `Promise.all` (`pwa.js:120-135`): sends race, and arrival order at the server
   is whatever the network makes it. The kit asks for *ordered*; v1 does not have
   it. (`flushBatch` is ordered — the array preserves `seq` — which is one reason
   it becomes the default path in v2.)
2. **A full store is silent.** `save()` swallows every storage failure
   (`pwa.js:76-79`), so `queue()` can report `ok: 1` for an entry that was never
   persisted — exactly the "accepted, then lost" lie Law 1 forbids. Found by
   reading, confirmed by the code path: there is no route from a
   `QuotaExceededError` to the world's UI.
3. **The default storage is origin-trapped** (§1.2).

### 2.3 The v2 contract

**Delivery: at-least-once, ordered, idempotent by entry id.**

- The library guarantees **at-least-once**: an entry leaves `queued` only on a
  server acknowledgement naming its id; anything else — timeout, network error,
  tab death mid-flight — returns it to `queued` (v1 already behaves this way;
  v2 states it as contract).
- **Ordering**: replay transmits strictly in `seq` order, one request in flight
  (or one ordered batch). No `Promise.all` on the send path.
- **Idempotency is the server's half, and the key is the entry id.** The id
  (`kind-device-seq-clock`, minted before first send) is the idempotency key; the
  server MUST treat a repeated id as a duplicate and return the *original*
  verdict, not an error and not a second effect. This is stated in the library's
  README as the server contract, because at-least-once without server-side
  dedupe is at-least-once duplication.
- **Retention is the server's *other* half, and this design does not choose it.**
  Dedupe by entry id makes delivery correct. It says nothing about whether the
  store keeps what it accepted. A sync log — derived by triggers, holding row
  images, compacted on a floor that moves by design — and an inalterable journal
  offer the *same* append-and-replay surface, and nothing in that surface tells
  the caller which one is behind the endpoint. Replay into a trimmable store is
  idempotent and the record is still destroyed later, silently, by compaction
  working exactly as specified. So the README states the server contract as
  **two** obligations rather than one: dedupe by entry id, **and** declare the
  retention floor — whether an accepted entry can ever be removed by a mechanism
  the client never calls. A world whose entries are a legal record must not point
  `endpoint` at a store that answers yes. The client cannot detect the difference
  and this library will not pretend to; naming the obligation is the whole of what
  a client can do about it. (The distinction is `ringserv`'s, routed here by
  Central on 2026-08-19 before this was built; its `docs/COMMONS.md` designs
  `Journal()` as a store *beside* the shape log rather than a setting on it,
  because a French inalterability rule disqualifies a movable floor by
  construction. Unpushed at the time of writing, so taken on report, not read.)

**Storage-full, mid-service** (brief §7 Q5): `queue()` persists **before**
returning. If the persist fails, the entry is refused —

```
{ ok: 0, problem: "storage-full", pending: 37 }
```

— never held memory-only (memory-only durability is a lie with a countdown), and
the named banner state **`STORAGE-FULL`** fires (§4). The refusal is the world's
signal to offer the R4 file mirror ("export the journal to free the queue") — a
degraded mode with a name and an exit, not a freeze (Law 5). What is *refused
rather than risked* (P4's phrasing): accepting an order the device cannot durably
hold.

**The API a world author writes against** — deltas from v1 marked:

```js
const pwa = await Pwa.attach(ring, {
    world:  "cousbox-remote",          // NEW, mandatory — storage identity (R2)
    device: "phone-7",                 // unchanged — id prefix, collision domain
    endpoint: "/api/commandes",        // NEW — batch default; `send` still accepted
    mirror: true,                      // NEW — offer the R4 file mirror
    silence: 8,                        // NEW — §3's alarm, seconds
    onChange: render,                  // unchanged
});

pwa.queue(kind, payload)   // -> {ok:1, id} | {ok:0, problem:"storage-full", ...}
pwa.pending()              // -> count       (unchanged)
pwa.oldest()               // NEW -> seconds the oldest queued entry has waited
pwa.rung                   // NEW -> §4      pwa.identity  // NEW -> §1 R2
pwa.flush()                // ordered in v2; batch when `endpoint` is set
```

And — new in kind, not just in surface — **the rung is pushed into Ring**
(`PwaRungSet`, maintained by the library; `PwaRung()` readable by world rules),
because refusals are business rules and business rules live in the Ring half,
not in UI glue. The example below depends on it.

### 2.4 The two features, against the API

The division of labour is the one both shipped samples already prove
(`route-orders/app.js:275-287`): **Ring decides, the library names and stores.**
The world's Ring half below is real code — it parses and runs against a stub of
the v2 surface, output included, in
[`partition-example/`](partition-example/README.md).

The Ring half (`orders.ring`, abridged — the full file runs; in the browser the
argument arrives as JSON through `ring.call` and returns the same way, exactly
as both samples do it today):

```ring
# Place an order. The device decides ALONE (P1): validation and the payment
# rule consult no server. Card payment is never optimistic (P4): it needs a
# live authority, so any rung below "streaming" refuses it by rule -- a cash
# order is accepted on every rung, including alone.
func OrderPlace aIn
    aItems = aIn[:items]
    cPay   = aIn[:pay]
    if islist(aItems) = 0 or len(aItems) = 0
        return [ :ok = 0, :refuse = "an order needs at least one item" ]
    ok
    if cPay = "card" and PwaRung() != "streaming"
        return [ :ok = 0,
                 :refuse = "card payment needs the server -- pay cash, or wait" ]
    ok
    cId = "loc-" + (len(aOrderId) + 1)
    aOrderId + cId
    aOrderState + "received"
    return [ :ok = 1, :payload = [ :id = cId, :pay = cPay ] ]

# Mark an order ready. Transitions are monotonic (P4): forward is legal on any
# rung and never rolls back -- Law 6's kitchen-blocking rollback is what this
# exists to prevent. The transition is an intent for the outbox, not a fetch.
func OrderMarkReady cId
    nRow = OrderRowOf(cId)
    if nRow = 0
        return [ :ok = 0, :refuse = "no such order here" ]
    ok
    if OrderStateRank(aOrderState[nRow]) >= OrderStateRank("ready")
        return [ :ok = 1, :already = aOrderState[nRow] ]     # idempotent re-press
    ok
    aOrderState[nRow] = "ready"
    return [ :ok = 1, :payload = [ :id = cId, :to = "ready" ] ]
```

The JS wiring — all of it — for both features:

```js
function placeOrder(form)  { decide("OrderPlace", form, "order"); }
function markReady(id)     { decide("OrderMarkReady", id, "transition"); }

function decide(fn, arg, kind) {
    const r = JSON.parse(ring.call(fn, arg).result);
    if (!r.ok) { banner(r.refuse); return; }          // named refusal, never a freeze
    const q = pwa.queue(kind, r.payload);             // durable BEFORE any send (Law 1)
    if (!q.ok) { banner(q.problem); return; }         // storage-full is loud, not lost
    render();                                         // pending() moved; the UI says so
}
```

The default path *is* the partition-tolerant path: neither feature contains a
`fetch`, a retry loop, or an `onLine` check. The world decides and queues; the
library delivers whenever delivery is possible.

## 3. The snapshot/stream client contract

Laws 2–4 as runtime behaviour. Nothing in this tree implements a stream today
(both samples are request/response); this section is the design for the library's
`stream` surface, v2's second half.

**The world registers two Ring functions at attach:**

```js
stream: { url: "/api/flux", apply: "SnapApply", reconcile: "SnapReconcile" }
```

- **`SnapApply cJson`** — receives the authoritative snapshot, whole. The
  contract is Law 2 verbatim: **clear, then load. Never merge.** The library does
  its half of the law by construction: it never delivers a partial snapshot, never
  delivers two concurrently, and never replays stream events that predate the
  snapshot it just delivered.
- **`SnapReconcile p`** — called immediately after `SnapApply`; returns the ids of
  locally-restored state the snapshot did **not** confirm. The library drops each
  from the outbox if still queued as a transition on a dead entity, and fires one
  `orphaned` event per id with the world's registered safe-screen hook (Law 3: the
  customer stuck on "received in kitchen" forever, with no exit, is the trap this
  closes).

**The event order after a reconnection is fixed, numbered, and part of the
contract** — a world may rely on it:

```
1. connected        the socket is up; nothing else has happened yet
2. snapshot         SnapApply ran: local caches REPLACED (Law 2)
3. orphaned ×N      SnapReconcile's unconfirmed ids, dropped (Law 3)
4. replay           outbox flush begins, in seq order (§2.3); per-entry
                    verdicts arrive as normal queue events
5. live             stream events flow; the world is at rung "streaming"
```

Replay comes **after** the snapshot, deliberately: a queued entry is an *intent*,
not state — its effect must land on the server's truth and come back as stream
events, not race the snapshot fetch and then look swallowed by it.

**The alarm** (Law 4): the library expects a heartbeat on the stream and fires
**`silent`** only after `silence` seconds (default **8** — the field-tuned value,
not a guess) of *true* silence; reconnection attempts are automatic and invisible
below that threshold. `alive` fires on the first byte after a silence. A
one-second blip produces no event at all — alarm fatigue trains the user to
ignore the one banner that matters, and that is a failure mode with a name.

**One flag for prompt 22, not ruled here** (per the kit §5): out-of-stock. The
snapshot-replaces rule already resolves the *reconnected* case mechanically — a
stale local "available" dies with the cache it lives in at step 2, no actor
needed. The case that remains is two devices **alone** (rung `alone`, L3) taking
orders against stock the other has exhausted; that is a merge-time question about
observation-vs-intent and belongs to the doctrine session. Flagged; not decided.

## 4. The degraded-mode surface

The client's seat sees fewer rungs than the brief's system ladder, and pretending
otherwise would be false precision: from inside a browser world, "no internet"
(D1), "router died" (D2) and "server host died" (D3) are one observable — *my
server stopped answering*. The client-view rungs, their mapping, and their names:

| `pwa.rung` | Means, from the client's seat | Brief's ladder | Banner state (named, Law 5) |
|---|---|---|---|
| `streaming` | heartbeats within the silence window | L0/L1 (indistinguishable from here) | none |
| `unreachable` | the alarm fired; outbox open; caches serve the UI | the client face of L1-broken/L2/L3 | `NETWORK-LOST` — "queue continues locally, resync automatic" + pending count |
| `alone` | booted from the service-worker cache; server never yet reached this session | L3 | `ALONE` — taking orders into the local journal |

Plus the two orthogonal states from §1–2, which are storage facts, not
connectivity: `STORAGE-PINNED-TO-ADDRESS` and `STORAGE-FULL`.

**Transitions**: `alone → streaming` (first snapshot), `streaming → unreachable`
(alarm), `unreachable → streaming` (the §3 five-step sequence completes). Exposed
as `pwa.rung`, a `rungchange` event, and `PwaRung()` in Ring (§2.3) so refusal
rules can consult it. **`navigator.onLine` is never consulted for rung
decisions** — it reports link association, not server reachability, and is true
with a dead router on half the failure ladder; v1's `online()` (`pwa.js:167`)
survives only as a hint for *when to retry sooner*, never as a rung.

**The minimum UI affordance contract**: every rung has a named banner state; every
refusal carries a sentence (`refuse:`/`problem:`, §2.4); no action may silently
spin — it completes locally, or it is refused with a name. **Never a freeze.**

**OS dialogs**: a browser world cannot intercept "no internet — use cellular?".
What the runtime can do is make the wrong answer benign, and the field already
proved the mechanism (kit §4: LAN traffic stays on Wi-Fi): every world request is
same-origin and relative. The library enforces its own half — `endpoint` and
`stream.url` are same-origin paths; a cross-origin URL there is refused at attach
with a named error — so no runtime request ever gives the OS a reason to route
away from the LAN.

## 5. The test story

The pattern to extend is already proven in this tree: `tests/orders-app.js` and
`tests/stock-count-app.js` drive the **real wasm VM** in Node against the **real
sample worlds** — not mocks of either — and assert on lockstep behaviour. The
partition harness is that pattern plus two pieces of honesty about what "server
gone" means.

**Piece 1 — the partition is a socket fact, not a mock flag.**
`tests/partition-harness.js` starts the world's server (RestoLean's
`commons/serveur.js` with `lancerSimulation5Jours`, or a scripted stand-in with
the same surface) behind a pass-through TCP proxy owned by the test:

```js
const net = harness.proxy(serverPort);   // world talks to net.port, never serverPort
net.sever();                             // closes the listener AND destroys live
                                         // sockets: in-flight requests die mid-body,
                                         // SSE streams break -- 15 August, on demand
net.heal();                              // the listener returns; snapshot is whatever
                                         // the REAL server now says (Law 2's authority
                                         // is not fabricated by the test)
```

For scripted-server runs, `harness.server.snapshot(S)` sets what the next
snapshot fetch returns, so ghost-purge cases can name their ghosts.

**Piece 2 — time is injected, so the alarm is testable.** The library takes
`timer`/`now` at attach (a v2 API requirement that exists *for this harness*);
`harness.clock.tick(8000)` fires the silence alarm deterministically. A test
never sleeps 8 real seconds, and the 8-second threshold is asserted, not assumed.

**The assertions the kit names, as a concrete scenario:**

```js
await world.boot();                                    // rung: streaming
net.sever();
clock.tick(9000);
assert(world.rung() === "unreachable");                // alarm fired once, not per retry
const a = world.placeOrder({items: [...], pay: "cash"});   // accepted: P1
const b = world.placeOrder({items: [...], pay: "card"});   // REFUSED by rule: P4
assert(b.refuse.includes("card"));
assert(world.pending() === 1 && world.banner() === "NETWORK-LOST");

world.seedRestoredState({id: "ghost-1", state: "received"});   // Law 3's trap
net.heal();
await world.settled();                                 // the §3 five-step sequence
assert(world.events()                                  // ORDER is the assertion:
  .matches(["connected","snapshot","orphaned:ghost-1","replay","live"]));
assert(world.hasNo("ghost-1"));                        // purged, with the safe screen
assert(server.received(a.id).count === 1);             // replayed exactly once...
net.flap(3); await world.flushTwice();
assert(server.received(a.id).count === 1);             // ...even after flaps: the id
                                                       // is the idempotency key
```

**The 5-day run**: the simulator's double-outage evening becomes two
`sever()/heal()` cycles at its scripted times; the pent-up-burst assertion is
that post-heal deliveries equal orders queued during the outage, in seq order,
each id seen exactly once server-side. This is a harness design, per the kit —
but every call above names a decision already made here (proxy not mock,
injected clock, event-order assertion, id-count assertion), so the next session
builds it without re-deciding it.

### Built, 2026-08-22 — and the first run sharpened the reconcile contract

`tests/partition-harness.js` (with `tests/partition/`: the TCP proxy, a
scripted server carrying the dedupe contract, a real SSE client over Node's
http, and the world under test). Twenty checks, **0.7 s wall, 5/5 stable
runs** — every assertion in the sketch above, over real severed sockets, on
the real wasm VM, against the shipped v2 library.

**What executing the design taught, which reading it did not**: the first
run reconciled away the device's own pending order. An id absent from the
healing snapshot is *not* automatically a ghost — a locally-placed order
that has not reached the server yet is absent **by definition**; it is an
intent still in the outbox, and dropping it eats the exact work the outbox
exists to protect. The rule that survives the harness, kind-aware and made
in the world's Ring where business judgement lives: **an unconfirmed id
with an entity-creating entry (`order`) still queued or in flight is en
route, kept; an unconfirmed id whose only outbox presence is a `transition`
is a ghost, purged — a transition mutates what must already exist, and
protecting a ghost because a transition rides on it re-opens Law 3's trap.**
The stand-in server carries the same surface as RestoLean's Commons
(snapshot-first SSE, per-entry batch verdicts, id-keyed dedupe), so pointing
the proxy at the real `commons/serveur.js` is a target swap, not a rebuild —
that run executes in RestoLean's repository, and is named rather than owned
here.

## 6. Divergences between the prompt and this tree

Reported, per the kit's own instruction, rather than silently resolved:

1. **Item 2 is not greenfield.** The durable outbox — local-first write, device
   ids, replay, rollback, visible pending, Background Sync — shipped in
   `ringscript-pwa` 1.1.0 on 2026-08-16 and is consumed by two samples and their
   harnesses. The prompt's Law-6 gap is the *JS prototype's* gap, already closed
   on this side. What v1 genuinely lacks, found by this survey: ordered replay
   (§2.2-1), a loud storage-full path (§2.2-2), origin-safe storage defaults
   (§1.2), the rung surface, and the stream contract — which is exactly the v2
   scope above.
2. **"Single-file worlds" does not describe a RingScript world.** A world here is
   a folder — page + `ringscript.js` + `ringscript.wasm` (+ `lib/`) — served or
   installed as a PWA. Single-file is the stzweb JS doctrine; inlining the wasm
   (~530 KB base64) is possible but is not today's shape and is not ruled here.
3. **Law 7's client face was tested, not assumed.** 4 000 two-byte characters
   through both output paths produced zero U+FFFD — the authoritative eval-result
   path decodes whole buffers. Residual: the live `onOutput` mirror decodes
   per-chunk without `{stream: true}` (`ringscript.js:48`), a one-line hardening
   for the next code session; it cannot corrupt the result path.
4. **L2 (device-to-device, no router) stays out of reach for browser worlds** —
   the brief's §6 finding, already routed to prompt 22; nothing in this design
   pretends otherwise. The rung ladder in §4 is honest about what a client can
   observe instead.
5. **The out-of-stock boundary is flagged to prompt 22** (§3), with one mechanical
   observation attached: snapshot-replaces resolves the *reconnection* half of the
   86 case without touching doctrine 3 at all.

## What this document does not do

No sync policy for business truth (doctrine 3 / prompt 22 territory). No build
step, bundler, or network dependency. No weakening of the customer-PWA
constraint. And no implementation beyond the compiling example — the v2 library
work this specifies is the next session's, with this document as its contract.
