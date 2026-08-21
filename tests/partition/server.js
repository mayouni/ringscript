/*
** The scripted stand-in server, with the same surface the design names for
** RestoLean's Commons: a snapshot-first SSE stream and a batch endpoint
** that answers per entry.
**
** It honours the server half of the outbox contract — THE ENTRY ID IS AN
** IDEMPOTENCY KEY: a repeated id gets its ORIGINAL verdict back and its
** effect is applied exactly once. It also counts delivery attempts
** separately from effects, because "the server saw the id twice and
** applied it once" is precisely what the harness must be able to assert.
*/
const http = require("http");

module.exports = function server(cb) {
    let orders = [];                 // the authoritative truth
    const verdicts = {};             // id -> the original verdict
    const attempts = {};             // id -> delivery attempts seen
    const effects = {};              // id -> times the effect was applied
    let refuse = null;               // id -> note, set by the test

    const srv = http.createServer((req, res) => {
        if (req.method === "GET" && req.url === "/flux") {
            res.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive"
            });
            /* the snapshot is the FIRST thing on the stream, whole —
               Law 2's authority speaking */
            res.write("event: snapshot\ndata: " +
                JSON.stringify({ orders: orders.slice() }) + "\n\n");
            return;      /* held open; heartbeats are the test's business */
        }
        if (req.method === "POST" && req.url === "/api/orders") {
            let body = "";
            req.setEncoding("utf8");
            req.on("data", (c) => { body += c; });
            req.on("end", () => {
                const batch = JSON.parse(body);
                const results = (batch.entries || []).map((e) => {
                    attempts[e.id] = (attempts[e.id] || 0) + 1;
                    if (verdicts[e.id]) { return verdicts[e.id]; }   // dedupe: original verdict
                    let v;
                    if (refuse && refuse.id === e.id) {
                        v = { id: e.id, status: "rejected", note: refuse.note };
                    } else {
                        effects[e.id] = (effects[e.id] || 0) + 1;
                        if (e.payload && e.payload.id) { orders.push(e.payload.id); }
                        v = { id: e.id, status: "accepted", note: "" };
                    }
                    verdicts[e.id] = v;
                    return v;
                });
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ results: results }));
            });
            return;
        }
        res.writeHead(404); res.end();
    });

    srv.listen(0, "127.0.0.1", () => cb({
        port: () => srv.address().port,
        setOrders: (list) => { orders = list.slice(); },
        refuseNext: (id, note) => { refuse = { id: id, note: note }; },
        attempts: (id) => attempts[id] || 0,
        effects: (id) => effects[id] || 0,
        orders: () => orders.slice(),
        close: () => new Promise((r) => srv.close(r))
    }));
};
