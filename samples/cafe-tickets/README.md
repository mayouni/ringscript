# Café Tickets — the partition-tolerance tutorial

The smallest application that survives a dead network, built step by step.
By the end you will have a ticket pad that **keeps taking orders with the
connection cut**, shows a **named** degraded mode instead of a spinner,
queues every ticket **durably before anything is sent**, replays the queue
by itself when the till returns — and refuses exactly one action while
offline, *by a rule written in Ring*.

It exists because of a real evening in a restaurant in France: a faulty
refrigerator kept tripping the breaker, every router reboot changed the
server's address, and hours of work became unreachable. The lessons from
that evening are a design document
([PARTITION-FOUNDATIONS.md](../../docs/PARTITION-FOUNDATIONS.md)) and a
library ([ringscript-pwa](https://github.com/mayouni/ringscript-pwa)).
This tutorial is the *using* of them — about 70 lines of Ring and 120 of
JavaScript, and none of the hard parts are yours to write.

## 0. What you need

The RingScript starter kit (or this repository). One command:

```bash
ringscript add pwa
```

That installs the library into `lib/pwa/`, wires its script tag into your
page, and records everything in `ringscript.lock` so it can be removed
exactly. Everything below builds on it.

## 1. The rules — `tickets.ring`

Write what the café *means*, with no browser in sight: place a ticket
(tables run 1 to 20, a ticket needs an item), serve a ticket (monotonic —
food that left the kitchen does not roll back), cancel a ticket. The file
in this folder is complete; the part to read twice is the cancel rule:

```ring
func TicketCancel cId
    if PwaRung(1) != "streaming"
        return JsonEncode([ :ok = 0,
            :refuse = "a cancellation needs the till -- it will be possible again when the connection returns" ])
    ok
    ...
```

`PwaRung()` is the library's **degraded-mode rung** — `alone`,
`streaming`, or `unreachable` — maintained by the library from what the
network actually does, and **pushed into the Ring VM** precisely so that
rules like this one live with the rest of your rules. A cancellation
touches the till's totals, so it needs the till. Placing a ticket does not,
so it never waits. That decision belongs in Ring, not in an `if` scattered
through UI code — and here it is, three lines, next to the rules it
belongs with.

## 2. The wiring — `app.js`

One attach:

```js
pwa = await Pwa.attach(ring, {
    world:  "cafe-tickets",     // the storage identity — never the URL
    device: "pad-1",
    sw: "sw.js",
    send: send,                 // how ONE entry reaches your till
    onChange: render
});
```

Two lines matter more than they look:

- **`world`** names the storage. Browsers bind storage to the *origin* —
  serve the same app from a different address and its storage appears
  empty. That is what destroyed that evening in France. The library keys
  everything by this name, tells you when your origin is a bare IP
  (`pwa.identity.pinned_to_ip`, the `STORAGE-PINNED-TO-ADDRESS` state),
  and offers a file mirror for data that must survive anything.
- **`send`** is the only server code you write: deliver one entry, throw
  on failure. Here it is a five-line pretend till so the tutorial runs
  from a folder; in production it is one `fetch` to one endpoint.

And every action is the same three-step shape — this is the whole pattern:

```js
function decide(fn, arg, kind) {
    var r = ask(fn, arg);                       // 1. Ring DECIDES
    if (!r.ok) { log(r.refuse); return; }       //    ...and refusals have names
    pwa.queue(kind, r.payload).then(function (q) {  // 2. the library STORES, durably,
        log(q.ok ? "" : q.problem);                 //    before ok — storage-full is
        render();                                   //    loud, never a silent loss
    });                                         // 3. the UI REPORTS
}
```

No `fetch` in the action path. No retry loop. No `navigator.onLine` check.
The library delivers whenever delivery is possible — on `flush()`, on the
connection returning, and via Background Sync even if the tab is closed.

## 3. The honesty — the banner

```js
var b = pwa.banner();      // "NETWORK-LOST" | "ALONE" | "STORAGE-FULL" | ... | null
```

The library names the state; the page translates it for the person holding
the pad ("Till unreachable — tickets queue on this pad and send themselves
when it returns"). The contract behind it: **never a freeze, never a
silent spinner** — every mode has a name, every refusal has a sentence.
And the alarm that raises `NETWORK-LOST` waits **eight seconds of true
silence** before firing, because a banner that cries at every one-second
blip trains people to ignore the one that matters.

## 4. The installability — `sw.js`

```js
importScripts("lib/pwa/sw-pwa.js");
PwaServiceWorker({ cache: "cafe-tickets-v1", shell: [ ...your files... ] });
```

Cache-first, so the pad opens with no network at all; Background Sync, so
a queue flushes even when the app is closed. The only part you write is
the file list, because only your app knows its own files.

## 5. Run it, then break it

Serve the repository (`ringscript serve 8379 .`) and open
`/samples/cafe-tickets/`. Then, in order:

1. Take a ticket. The rung says `streaming`; the ticket is queued, sent,
   done.
2. **Cut the connection.** Take three more tickets — they queue, the
   counter shows `3 waiting`, and after eight seconds the banner names the
   mode. Serve one: also fine, monotonic.
3. Try to **cancel** one. Refused, politely, by the Ring rule — with a
   sentence that says when it will work again.
4. **Restore the connection.** Watch the queue drain, in order, by
   itself. Each ticket carries an id minted on the pad before any send,
   so a retry can never become a duplicate order.
5. Reload the page mid-outage. The queue is still there — it was durable
   before `ok`, in IndexedDB keyed by the world's *name*, not its address.

## 6. What the tests check

`node tests/cafe-tickets-app.js` drives the same rules on the real wasm VM
with no browser: the refusals, the monotonic serve, and the cancel rule
flipping with the rung. The heavyweight verification lives one level up —
`tests/partition-harness.js` severs real sockets under a full world and
asserts replay order, ghost purging and the alarm's exact timing.

## The point, restated

Nothing in this folder handles a partition. The *library* handles the
partition; the app wrote three Ring functions, one attach, one `send`, and
a banner translation. That is the division the restaurant evening taught:
the hard parts of surviving a dead network are the same for every
application, so they belong in a library — and what remains for you is
exactly the part that is yours: **what your application means**.
