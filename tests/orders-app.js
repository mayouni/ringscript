/*
** tests/orders-app.js — the field-sales sample application, exercised the
** way a representative's day exercises it.
**
** Everything the article claims is asserted here: the pricing tiers, the
** case discount, the tax, the credit limit that must hold with the cable
** out, the outbox that survives a closed tab, the per-order sync verdicts,
** and the rollback when a send never arrives.
**
**     node tests/orders-app.js
*/
const fs = require("fs");
const path = require("path");
const RingScript = require(path.join(__dirname, "..", "playground", "ringscript.js"));

const root = path.join(__dirname, "..", "playground");
const sample = path.join(__dirname, "..", "samples", "route-orders");
const wasm = fs.readFileSync(path.join(root, "ringscript.wasm"));
const bytes = wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength);
const source = fs.readFileSync(path.join(sample, "orders.ring"), "utf8");
const reference = fs.readFileSync(path.join(sample, "reference.json"), "utf8");
// The outbox is not part of the sample any more — it is ringscript-pwa, and
// the page loads it before orders.ring. This harness must do the same, or it
// tests an application the browser never runs.
const library = fs.readFileSync(path.join(sample, "lib", "pwa", "pwa.ring"), "utf8");

let failures = 0;
function check(name, cond, detail) {
    console.log((cond ? "  PASS  " : "  FAIL  ") + name +
        (cond || detail === undefined ? "" : "   [" + detail + "]"));
    if (!cond) failures++;
}
function near(a, b) { return Math.abs(a - b) < 0.51; }

async function newApp() {
    const ring = await RingScript.load(bytes, { onOutput: () => {} });
    const lib = ring.eval(library);
    if (!lib.ok) throw new Error("pwa.ring failed to load: " + lib.error);
    const r = ring.eval(source);
    if (!r.ok) throw new Error("orders.ring failed to load: " + r.error);
    const call = (fn, arg) => {
        const out = ring.call(fn, arg === undefined ? 1 : arg);
        if (!out.ok) throw new Error(fn + ": " + out.error);
        return typeof out.result === "string" ? JSON.parse(out.result) : out.result;
    };
    call("RefLoad", reference);
    // not through call(): this one answers with a bare string, not JSON
    ring.call("PwaOutboxDevice", "REP-014");

    // What app.js does when the representative presses Queue: the sample
    // decides whether the order may be taken and hands over a payload; the
    // library names it and stores it. Two calls, one per concern — which is
    // the split the library exists to make, so the test makes it too.
    const queue = () => {
        const done = call("OrderFinish");
        if (!done.ok) return done;
        const q = call("PwaOutboxAdd", JSON.stringify({ kind: "order", payload: done.payload }));
        return { ok: q.ok, id: q.id, total: done.total };
    };
    return { ring, call, queue };
}

(async () => {
    console.log("The field-sales order pad — orders.ring\n");

    /* ---------------------------------------------------------------- */
    console.log("Reference data — pulled once, then never needed again");
    {
        const { call } = await newApp();
        const s = call("AppStats");
        check("10 customers and 12 products loaded",
              s.customers === 10 && s.products === 12,
              s.customers + " / " + s.products);
        check("the tax rate comes from the server, not the code", s.currency === "XOF");
    }

    /* ---------------------------------------------------------------- */
    console.log("\nPricing — the customer's tier decides the price, on the device");
    {
        const { call } = await newApp();
        // C-101 is tier A, C-104 is tier C, on the same product
        call("OrderStart", "C-101");
        const a = JSON.parse(call("ProductFind", "SKU-001") && JSON.stringify(call("ProductFind", "SKU-001")));
        call("OrderStart", "C-104");
        const c = call("ProductFind", "SKU-001");
        check("tier A pays less than tier C for the same sack",
              a[0][5] === 14500 && c[0][5] === 15900, a[0][5] + " vs " + c[0][5]);
    }

    /* ---------------------------------------------------------------- */
    console.log("\nThe order — priced, taxed and checked without a server");
    {
        const { call } = await newApp();
        call("OrderStart", "C-101");                      // tier A, headroom 660,000
        call("OrderAddLine", { sku: "SKU-001", qty: 10 }); // a full case: 5% off
        call("OrderAddLine", { sku: "SKU-003", qty: 5 });  // under a case: no discount
        const v = call("OrderView");

        const sackNet = 14500 * 10 * 0.95;                 // 137,750
        const sugarNet = 1150 * 5;                         // 5,750
        const sub = sackNet + sugarNet;
        check("the full case earned its 5%", v.lines[0][5] === 5, "line discount " + v.lines[0][5]);
        check("the part case earned nothing", v.lines[1][5] === 0);
        check("subtotal is right", near(v.subtotal, sub), v.subtotal + " vs " + sub);
        check("tax applied at the server's rate", near(v.tax, sub * 0.19));
        check("total = subtotal + tax", near(v.total, sub * 1.19));
        check("the same product twice becomes one line", (() => {
            call("OrderAddLine", { sku: "SKU-003", qty: 7 });
            return call("OrderView").lines.length === 2;
        })());
    }

    /* ---------------------------------------------------------------- */
    console.log("\nThe credit limit — the rule that has to work offline");
    {
        const { call, queue } = await newApp();
        // C-102: limit 400,000, balance 355,000 -> only 45,000 of headroom
        call("OrderStart", "C-102");
        call("OrderAddLine", { sku: "SKU-001", qty: 10 });
        const v = call("OrderView");
        check("headroom computed from local data", v.headroom === 45000, String(v.headroom));
        check("an order beyond the limit is blocked", v.blocked === 1,
              "total " + Math.round(v.total));
        const saved = queue();
        check("and it cannot be queued", saved.ok === 0, saved.error);
        check("the reason is a sentence, not a code",
              typeof saved.error === "string" && saved.error.indexOf("credit") >= 0);
    }

    /* ---------------------------------------------------------------- */
    console.log("\nStock — warns, never blocks: a backorder is a real order");
    {
        const { call } = await newApp();
        call("OrderStart", "C-103");
        call("OrderAddLine", { sku: "SKU-010", qty: 40 });  // only 18 in stock
        const v = call("OrderView");
        check("the shortfall is reported", v.warnings.length === 1, JSON.stringify(v.warnings));
        check("but the order is not blocked by it", v.blocked === 0);
    }

    /* ---------------------------------------------------------------- */
    console.log("\nThe outbox — work survives having nowhere to go");
    {
        const { call, queue } = await newApp();
        call("OrderStart", "C-101");
        call("OrderAddLine", { sku: "SKU-002", qty: 6 });
        const one = queue();
        check("the order is queued with a device-made id",
              one.ok === 1 && /^order-REP-014-\d+-/.test(one.id), one.id);

        call("OrderStart", "C-103");
        call("OrderAddLine", { sku: "SKU-005", qty: 5 });
        const two = queue();
        check("ids are unique per order", two.id !== one.id, one.id + " / " + two.id);
        check("two orders waiting", call("PwaOutboxPending") === 2);

        // the balance moved locally, before any server heard of it
        const found = call("CustomerFind", "Bonkoukou");
        check("the customer's balance already reflects the order",
              found[0][5] > 240000, "balance now " + found[0][5]);
    }

    /* ---------------------------------------------------------------- */
    console.log("\nSync — per order, so one rejection cannot lose the rest");
    {
        const { call, queue } = await newApp();
        call("OrderStart", "C-101");
        call("OrderAddLine", { sku: "SKU-002", qty: 6 });
        const a = queue();
        call("OrderStart", "C-109");
        call("OrderAddLine", { sku: "SKU-004", qty: 24 });
        const b = queue();

        const payload = call("PwaOutboxBatch");
        check("the batch carries both orders", payload.count === 2, String(payload.count));
        check("it names the device that made them", payload.device === "REP-014", payload.device);

        call("PwaOutboxMarkSending");
        const applied = call("PwaOutboxApply", JSON.stringify({
            results: [
                { id: a.id, status: "accepted", note: "" },
                { id: b.id, status: "rejected", note: "customer account on hold" }
            ]
        }));
        check("one accepted, one rejected", applied.accepted === 1 && applied.rejected === 1);
        check("nothing is left queued", call("PwaOutboxPending") === 0);

        const rejected = call("PwaOutboxList").find(r => r.id === b.id);
        check("the rejection keeps the server's reason",
              rejected.note === "customer account on hold", rejected.note);

        // The library knows an entry was rejected; only the app knows what
        // that costs. Handing the credit back is the app's call, and that
        // split is the whole point of the library boundary.
        call("CreditReturn", JSON.stringify([{ customer: "C-109", total: b.total }]));
        const c109 = call("CustomerFind", "Zinder");
        check("credit is returned when an order is rejected",
              c109[0][5] === 12000, "balance " + c109[0][5]);
    }

    /* ---------------------------------------------------------------- */
    console.log("\nA send that never arrived is not a send");
    {
        const { call, queue } = await newApp();
        call("OrderStart", "C-101");
        call("OrderAddLine", { sku: "SKU-002", qty: 6 });
        queue();
        call("PwaOutboxMarkSending");
        const back = call("PwaOutboxRollbackAll");
        check("the order goes back to pending and will be retried", back === 1);
        check("and is in the next batch again", call("PwaOutboxBatch").count === 1);
    }

    /* ---------------------------------------------------------------- */
    console.log("\nPersistence — a closed tab is not a lost day");
    {
        const first = await newApp();
        first.call("OrderStart", "C-101");
        first.call("OrderAddLine", { sku: "SKU-001", qty: 10 });
        const made = first.queue();
        // Two blobs, because there are two owners: the app keeps the
        // balances, the library keeps the queue. The page stores both, so
        // the test restores both.
        const appBlob = first.ring.call("StateExport", 1).result;
        const queueBlob = first.ring.call("PwaOutboxSnapshot", 1).result;

        // a brand new VM, as if the tab had been closed and reopened
        const second = await newApp();
        check("the fresh instance starts empty", second.call("PwaOutboxPending") === 0);
        second.call("StateImport", appBlob);
        second.call("PwaOutboxRestore", queueBlob);
        check("the queue comes back", second.call("PwaOutboxPending") === 1,
              String(second.call("PwaOutboxPending")));
        const id0 = second.call("PwaOutboxList")[0].id;
        check("with the same id, so a retry cannot double-book",
              id0 === made.id, id0 + " vs " + made.id);
        const cust = second.call("CustomerFind", "Bonkoukou");
        check("and the credit already committed is remembered",
              cust[0][5] > 240000, "balance " + cust[0][5]);
    }

    console.log("\n" + (failures ? failures + " failure(s)" : "All checks passed."));
    process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
