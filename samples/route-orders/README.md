# Route Orders — a local-first business application

A field-sales order pad. A representative walks a route of shops, takes
orders from a catalogue, and the orders reach the back office later.

It is an ordinary web project — HTML, CSS, JavaScript, no build step, no
dependencies — with one difference: **the business rules are written in
Ring** and run on the device, in the browser, on the real Ring virtual
machine compiled to WebAssembly.

**[Open the running sample →](https://mayouni.github.io/ringscript/samples/route-orders/)**
&nbsp;·&nbsp;
[the write-up](https://mayouni.github.io/ringscript/blog-local-first-app.html)

## Run it

Any static server will do — the sample fetches its own files, so opening
`index.html` from the filesystem will not work.

```bash
# from the repository root
python -m http.server 8000
# then open http://localhost:8000/samples/route-orders/
```

To lift the folder somewhere else, copy the two runtime files beside it and
point `RUNTIME` at them:

```bash
cp playground/ringscript.js playground/ringscript.wasm samples/route-orders/
# then in app.js:  var RUNTIME = "";
```

Nothing else is needed. There is no `npm install`, no bundler, no
transpiler and no lock file.

## The one thing to take away

| File | What it holds |
|---|---|
| `index.html` | the interface — ordinary semantic markup |
| `app.css` | the presentation — ordinary CSS, no framework |
| `app.js` | the wires — `fetch`, `localStorage`, the DOM, event handlers |
| **`orders.ring`** | **the business logic and the data** |
| `reference.json` | a fixture standing in for `GET /reference` |

**Ring does not draw anything.** It never touches the DOM and has never
heard of `localStorage`. It answers questions:

```js
const view = ask("OrderView");        // what does this order come to?
renderOrder(view);                    // ...and the page decides how that looks
```

Rewrite `app.js` in React, Vue or Svelte tomorrow and `orders.ring` does not
change. Neither does your back end.

## What is decided on the device

Every rule that says whether an order is valid, and therefore every rule
that would have stopped working when the connection did:

- the customer's **price tier** (A, B or C — a property of the customer)
- the **full-case discount** (5% at or above the case size)
- **tax**, at the rate the server sent — never hard-coded
- the **stock check**, which warns but does not block, because a backorder
  is a real order
- the **credit limit**, checked against a balance the device keeps moving as
  orders are taken, hours before any server hears about them

Open the sample, press **Cut the connection**, and do all of it anyway.

## The outbox

A finished order does not go to the network. It goes into a queue with an id
the **device** generated (`REP-014-7`). Three consequences, each a bug you do
not have to fix later:

- **a retry cannot double-book** — the id existed before the first attempt,
  so the server can reject a duplicate by id
- **a send that never arrived is not a send** — a failed request puts
  everything back to `pending` and it will be tried again
- **one rejection does not lose the other nine** — the server answers per
  order, and the device reconciles each verdict, including handing back the
  credit a rejected order had provisionally taken

## Your two endpoints

This is the whole back-end contract. Implement it in Django, Laravel,
Spring, Rails, Node, Go, .NET or Ring — the device does not know and does
not care.

**`GET /reference`** — everything the device needs to work alone:

```json
{
  "catalogueDate": "2026-08-09",
  "currency": "XOF",
  "taxRate": 0.19,
  "deviceId": "REP-014",
  "customers": [
    ["C-101", "Alimentation Bonkoukou", "Niamey", "A", 900000, 240000]
  ],
  "products": [
    ["SKU-001", "Rice, long grain 25 kg", "sack", 10, 140, 14500, 15200, 15900]
  ]
}
```

Rows rather than objects: the same data as `{"id": …, "name": …}` costs about
four times the memory and fifteen times the decode time. It makes no
difference at this size and all the difference at twenty thousand rows.

**`POST /orders`** — the finished work:

```json
{ "device": "REP-014", "catalogue": "2026-08-09", "count": 2,
  "orders": [ { "id": "REP-014-1", "customer": "C-101",
                "total": 163923, "order": "…the priced order…" } ] }
```

The answer carries **one verdict per order**:

```json
{ "results": [
    { "id": "REP-014-1", "status": "accepted", "note": "" },
    { "id": "REP-014-2", "status": "rejected",
      "note": "account on hold — settle the balance first" } ] }
```

Note `catalogue` in the request: the device says which price list it used, so
the server can refuse an order priced against a stale one.

## Two Ring details worth knowing

**Every function called from the page takes exactly one parameter.** That is
what `ring.call` passes; a zero-parameter function simply errors.

**Atom keys are lowercased on the way out.** Write `:stillQueued` in Ring and
JavaScript reads `stillqueued`. Every key this sample returns is
`snake_case`, which survives verbatim — what is written in the Ring file is
exactly what the page receives.

## Tests

The rules are asserted rather than described:

```bash
node tests/orders-app.js
```

Pricing tiers, the case discount, the tax, the credit block, the stock
warning that must *not* block, outbox ids, per-order sync, the rollback, and
a restart that restores the queue with its ids and its committed credit.

## Licence

MIT, like the rest of RingScript. Take it apart, change the trade, keep the
shape.

## Built on ringscript-pwa

The outbox is not written here. It comes from a library:

```bash
ringscript add pwa
```

`orders.ring` keeps the sales rules — the price tier, the case discount, the
stock check, the credit limit, and whether an order **may** be queued. The
library owns what queueing *means*: the id made on the device, the batch,
the per-order verdicts, and the rollback when a request never arrives.

The one thing that stayed is the one thing a queue cannot know: **what a
refusal costs**. When the server rejects an order, `CreditReturn` gives the
customer their credit back, because the order did not happen. That is a
sales rule, so it is in Ring.

That split removed **192 lines** from this sample.

It also grew the library. Stock-count sends one count a shift and was happy
sending one entry at a time; this sends a route's worth of orders, where ten
requests are ten chances to fail on a bad link. So
[ringscript-pwa 1.1](https://github.com/mayouni/ringscript-pwa/releases/tag/v1.1.0)
gained a batch the server answers per entry — a second consumer is what
shows an abstraction what it is actually missing.

No service worker here: this sample is about where the rules live.
[stock-count](../stock-count/) is the one about installing.
