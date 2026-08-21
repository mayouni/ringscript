/*
** The partition harness — PARTITION-FOUNDATIONS.md §5, built as designed.
**
** A real world (tests/partition/world.ring) on the REAL wasm VM, attached
** to the REAL v2 library (the copy the route-orders sample consumes), talks
** to a scripted server through a REAL TCP proxy. "Server gone" is a socket
** fact: sever() destroys live connections mid-stream. Time is the injected
** clock, so the 8-second alarm is asserted, never slept through.
**
**     node tests/partition-harness.js
*/
const fs = require("fs"), path = require("path");
const RingScript = require(path.join(__dirname, "..", "playground", "ringscript.js"));
require(path.join(__dirname, "..", "samples", "route-orders", "lib", "pwa", "pwa.js"));
const NodeEventSource = require("./partition/eventsource");
const mkServer = require("./partition/server");
const mkProxy = require("./partition/proxy");

const LIB = fs.readFileSync(path.join(__dirname, "..", "samples", "route-orders", "lib", "pwa", "pwa.ring"), "utf8");
const WORLD = fs.readFileSync(path.join(__dirname, "partition", "world.ring"), "utf8");

let bad = 0;
const ok = (n, c, d) => { console.log((c ? "  PASS  " : "  FAIL  ") + n +
    (c || d === undefined ? "" : "  [" + JSON.stringify(d) + "]")); if (!c) bad++; };

function manualClock() {
    let t = 1755640000000, seq = 0, due = [];
    return {
        now: () => t,
        timer: {
            set: (fn, ms) => { const id = ++seq; due.push({ id, at: t + ms, fn }); return id; },
            clear: (id) => { due = due.filter(d => d.id !== id); }
        },
        tick: (ms) => {
            t += ms;
            const fire = due.filter(d => d.at <= t); due = due.filter(d => d.at > t);
            fire.forEach(d => d.fn());
        }
    };
}

/* wait for a named event once, with a real-time safety net */
function once(pwa, name, ms) {
    return new Promise((resolve, reject) => {
        const guard = setTimeout(() => reject(new Error("timed out waiting for " + name)), ms || 5000);
        pwa.on(name, () => { clearTimeout(guard); resolve(); });
    });
}
const settle = (ms) => new Promise(r => setTimeout(r, ms || 150));

(async () => {
    const t0 = Date.now();
    const b = fs.readFileSync(path.join(__dirname, "..", "playground", "ringscript.wasm"));
    const ring = await RingScript.load(
        b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), { onOutput: () => {} });

    const server = await new Promise(r => mkServer(r));
    const net = await new Promise(r => mkProxy(server.port(), r));
    const base = "http://127.0.0.1:" + net.port();
    const clk = manualClock();
    const events = [];

    server.setOrders(["srv-1"]);

    const pwa = await Pwa.attach(ring, {
        world: "partition-test", device: "tab-1",
        storage: Pwa.drivers.memory(),
        endpoint: base + "/api/orders",
        silence: 8,
        now: clk.now, timer: clk.timer,
        eventSource: NodeEventSource,
        ringSource: LIB,
        stream: { url: base + "/flux", apply: "WSnapApply", reconcile: "WSnapReconcile" }
    });
    ["connected", "snapshot", "replay", "live", "silent", "alive"]
        .forEach(n => pwa.on(n, () => events.push(n)));
    pwa.on("orphaned", (id) => events.push("orphaned:" + id));

    const wv = ring.eval(WORLD);
    if (!wv.ok) { throw new Error("world.ring: " + wv.error); }

    /* ---- boot: the five-step sequence over real sockets --------------- */
    await once(pwa, "live");
    ok("boot reaches live through the proxy, in order",
       events.join() === "connected,snapshot,replay,live", events);
    ok("the snapshot is held (clear-then-load)",
       JSON.parse(ring.call("WHeld", 1).result).join() === "srv-1");
    ok("rung is streaming", pwa.rung() === "streaming");
    events.length = 0;

    /* ---- the outage: a socket fact, an alarm on the injected clock ---- */
    await net.sever();
    await settle();                       // the SSE client notices the break
    ok("a broken stream is not yet an outage (Law 4)", pwa.rung() === "streaming");
    clk.tick(7000);
    ok("...seven seconds of silence still is not", pwa.rung() === "streaming");
    clk.tick(2000);
    ok("nine seconds is: unreachable, silent once, NETWORK-LOST",
       pwa.rung() === "unreachable" && events.join() === "silent" &&
       pwa.banner() === "NETWORK-LOST", { rung: pwa.rung(), events });

    /* ---- the device decides alone (P1 / P4), and queues durably ------- */
    const cash = JSON.parse(ring.call("WOrderPlace",
        JSON.stringify({ id: "loc-7", pay: "cash" })).result);
    ok("a cash order is accepted while unreachable (P1)", cash.ok === 1);
    const q1 = await pwa.queue("order", cash.payload);
    ok("...and queued durably with a device id", q1.ok === 1 && /^order-tab-1-/.test(q1.id));

    const card = JSON.parse(ring.call("WOrderPlace",
        JSON.stringify({ id: "loc-8", pay: "card" })).result);
    ok("a card order is refused BY RULE, read from the rung in Ring (P4)",
       card.ok === 0 && card.refuse.indexOf("card") >= 0, card);

    const ready = JSON.parse(ring.call("WOrderMarkReady", "srv-1").result);
    const q2 = await pwa.queue("transition", ready.payload);
    ok("a ready transition queues on any rung — never a rollback (Law 6 inverted)",
       ready.ok === 1 && q2.ok === 1);

    /* a ghost: locally-restored state the server will not confirm, with a
       queued transition riding on it (Law 3's trap) */
    ring.call("WSeed", "ghost-1");
    const ghostQ = await pwa.queue("transition", { id: "ghost-1", to: "ready" });
    ok("three entries pending, oldest age visible", pwa.pending() === 3 && pwa.oldest() >= 0);

    /* a flush against a severed proxy must fail loudly and roll back */
    await pwa.flush().catch(() => {});
    ok("a flush into the partition rolls the batch back, nothing lost",
       pwa.pending() === 3);

    /* ---- the heal: the contractual sequence, ghosts purged, replay ---- */
    events.length = 0;
    server.setOrders(["srv-1"]);          // the authority: ghost-1 unknown
    await net.heal();
    await once(pwa, "live");
    /* alive/silent are rung telemetry, not part of the five-step contract */
    const contract = events.filter(e => e !== "alive" && e !== "silent");
    ok("after the heal, the event order is the contract",
       contract.join() === "connected,snapshot,orphaned:ghost-1,replay,live",
       events);
    ok("the ghost is purged from the world (Law 3)", ring.call("WHas", "ghost-1").result === 0);
    ok("the ghost's queued transition was dropped; the real work was replayed",
       pwa.pending() === 0, pwa.list().map(e => e.id + ":" + e.state));
    ok("the server applied the cash order exactly once",
       server.effects(q1.id) === 1 && server.orders().indexOf("loc-7") >= 0);
    ok("rung is streaming again", pwa.rung() === "streaming");

    /* ---- idempotency: a retry of an already-answered id --------------- */
    const replayed = await fetch(base + "/api/orders", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device: "tab-1", count: 1,
            entries: [{ id: q1.id, kind: "order", payload: cash.payload }] })
    }).then(r => r.json());
    ok("a re-delivered id gets the ORIGINAL verdict, not a second effect",
       replayed.results[0].status === "accepted" &&
       server.attempts(q1.id) === 2 && server.effects(q1.id) === 1,
       { attempts: server.attempts(q1.id), effects: server.effects(q1.id) });

    /* ---- the double-outage evening, in miniature ---------------------- */
    let queuedDuring = 0;
    for (let cycle = 1; cycle <= 2; cycle++) {
        await net.sever(); await settle();
        clk.tick(9000);
        for (let i = 0; i < 2; i++) {
            const o = JSON.parse(ring.call("WOrderPlace",
                JSON.stringify({ id: "eve-" + cycle + "-" + i, pay: "cash" })).result);
            const q = await pwa.queue("order", o.payload);
            if (q.ok) { queuedDuring++; }
        }
        events.length = 0;
        await net.heal();
        await once(pwa, "live");
    }
    const delivered = ["eve-1-0", "eve-1-1", "eve-2-0", "eve-2-1"]
        .filter(id => server.orders().indexOf(id) >= 0).length;
    ok("the pent-up burst: everything queued during both outages arrived, once each",
       queuedDuring === 4 && delivered === 4 && pwa.pending() === 0,
       { queuedDuring, delivered, pending: pwa.pending() });

    /* ---- a rejection is a verdict, not a loss ------------------------- */
    server.refuseNext(null); // (id set below, after the queue mints it)
    const late = JSON.parse(ring.call("WOrderPlace",
        JSON.stringify({ id: "loc-99", pay: "cash" })).result);
    const q9 = await pwa.queue("order", late.payload);
    server.refuseNext(q9.id, "account on hold");
    await pwa.flush();
    const row = pwa.list().find(e => e.id === q9.id);
    ok("a per-entry rejection lands with the server's reason, others untouched",
       row.state === "rejected" && row.note === "account on hold" && pwa.pending() === 0,
       row);

    if (pwa.stream) { pwa.stream.close(); }
    await net.close(); await server.close();
    console.log("\n" + (bad ? bad + " FAILED" : "All partition checks passed.") +
        "   (" + ((Date.now() - t0) / 1000).toFixed(1) + " s wall)");
    process.exit(bad ? 1 : 0);
})().catch(e => { console.error("ERROR", e); process.exit(1); });
