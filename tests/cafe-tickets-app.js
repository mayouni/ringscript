/*
** The tutorial app's rules, on the real wasm VM, with no browser.
**
**   node tests/cafe-tickets-app.js
*/
const fs = require("fs"), path = require("path");
const REPO = path.join(__dirname, "..");
const RingScript = require(path.join(REPO, "playground", "ringscript.js"));
const SAMPLE = path.join(REPO, "samples", "cafe-tickets");

let bad = 0;
const ok = (n, c, d) => { console.log((c ? "  PASS  " : "  FAIL  ") + n +
    (c || d === undefined ? "" : "  [" + JSON.stringify(d) + "]")); if (!c) bad++; };

(async () => {
    const b = fs.readFileSync(path.join(REPO, "playground", "ringscript.wasm"));
    const vm = await RingScript.load(
        b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), { onOutput: () => {} });
    for (const f of [path.join(SAMPLE, "lib", "pwa", "pwa.ring"),
                     path.join(SAMPLE, "tickets.ring")]) {
        const e = vm.eval(fs.readFileSync(f, "utf8"));
        if (!e.ok) { console.log("EVAL FAILED " + f + ": " + e.error); process.exit(1); }
    }
    const call = (f, a) => {
        const r = vm.call(f, a === undefined ? 1 : a);
        if (!r.ok) throw new Error(f + ": " + r.error);
        const v = r.result;
        return (typeof v === "string" && (v.trim()[0] === "{" || v.trim()[0] === "["))
            ? JSON.parse(v) : v;
    };

    let t = call("TicketPlace", { table: 4, item: "un café" });
    ok("a ticket places, with a payload the outbox can carry",
       t.ok === 1 && t.payload.id === "t-1" && t.payload.table === 4, t);
    ok("tables run 1 to 20", call("TicketPlace", { table: 40, item: "x" }).ok === 0);
    ok("a ticket needs an item", call("TicketPlace", { table: 3, item: "" }).ok === 0);

    ok("serving is allowed on ANY rung (boot rung is alone)",
       call("TicketServe", "t-1").ok === 1);
    ok("serving a ghost is refused by name",
       call("TicketServe", "t-99").refuse === "no such ticket");

    call("TicketPlace", { table: 2, item: "thé à la menthe" });
    const c1 = call("TicketCancel", "t-2");
    ok("cancelling while not streaming is refused BY THE RING RULE",
       c1.ok === 0 && c1.refuse.indexOf("till") >= 0, c1);
    vm.call("PwaRungSet", "streaming");
    ok("...and allowed the moment the rung says streaming",
       call("TicketCancel", "t-2").ok === 1);
    vm.call("PwaRungSet", "unreachable");
    ok("...and refused again when the alarm has fired",
       call("TicketCancel", "t-2").ok === 0);

    const list = call("TicketList");
    ok("the list tells the whole story",
       list.length === 2 && list[0].state === "served" && list[1].state === "cancelled",
       list.map(x => x.state));

    console.log(bad ? "\n" + bad + " FAILED" : "\nAll cafe-tickets checks passed.");
    process.exit(bad ? 1 : 0);
})().catch(e => { console.error("ERROR", e); process.exit(1); });
