# LinkedIn post — Route Orders, the local-first sample

Ready to paste. Roughly 1,300 characters, which is under LinkedIn's
"see more" fold on most screens for the first three lines and reads
cleanly on a phone.

---

Most business applications are written as if the network were part of the
computer.

Take that assumption away — a market in Niamey, a warehouse basement in
Lyon, a train, a hospital corridor, a client who will not let their data
leave the building — and what is left is usually a spinner.

So I built the opposite, and put it online to be tried rather than
described.

**Route Orders** is a field-sales order pad: a representative walks a route
of shops and takes orders. Every rule that decides whether an order is
valid — the customer's price tier, the full-case discount, the tax, the
stock check, the credit limit — runs **on the device**, written in Ring,
executing in the browser on the real Ring virtual machine compiled to
WebAssembly.

The server is used exactly twice: once to pull the reference data, once to
push the finished orders.

There is a switch on the page marked **Cut the connection**. Press it and
keep working. Nothing degrades. A measured session: **9 actions on the
device, 2 network calls, 3 KB over the wire, and zero actions that failed
for want of a line.**

The part I would ask you to steal is not the language. It is the shape:

→ the rules live where the work happens
→ finished work goes into an outbox with an id the device generated, so a
retry can never double-book
→ the server answers per order, so one rejection never loses the other nine
→ two HTTP endpoints, plain JSON — your back end stays in Django, Laravel,
Spring, Node, Go, whatever you already run

For those of us building for places where the connection is a guest, this
is not an optimisation. It is the difference between software people use
and software they abandon. And for everyone else, it is increasingly what
clients mean when they ask who holds their data.

Try it, cut the line, and read the wire log:
https://mayouni.github.io/ringscript/playground/orders.html

The write-up, with both endpoints in full:
https://mayouni.github.io/ringscript/blog-local-first-app.html

#LocalFirst #OfflineFirst #WebAssembly #SoftwareArchitecture #Africa

---

## A shorter variant, if you prefer under 900 characters

Most business apps assume the network is part of the computer. Remove that
assumption — a market in Niamey, a basement in Lyon, a hospital corridor —
and what is left is a spinner.

So I built the opposite. **Route Orders**: a field-sales order pad where
every business rule (price tiers, discounts, tax, stock, the credit limit)
runs on the device, in Ring, on the real virtual machine compiled to
WebAssembly. The server is used exactly twice — pull the reference data,
push the finished orders.

There is a switch marked **Cut the connection**. Press it and keep working.
9 actions on the device, 2 network calls, 3 KB, zero failures.

Steal the shape, not the language: rules where the work happens, an outbox
with device-made ids so retries cannot double-book, one verdict per order,
two JSON endpoints — your back end stays exactly where it is.

https://mayouni.github.io/ringscript/playground/orders.html

#LocalFirst #OfflineFirst #WebAssembly
