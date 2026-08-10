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
const wasm = fs.readFileSync(path.join(root, "ringscript.wasm"));
const bytes = wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength);
const source = fs.readFileSync(path.join(root, "orders.ring"), "utf8");
const reference = fs.readFileSync(path.join(root, "orders-reference.json"), "utf8");

let failures = 0;
function check(name, cond, detail) {
    console.log((cond ? "  PASS  " : "  FAIL  ") + name +
        (cond || detail === undefined ? "" : "   [" + detail + "]"));
    if (!cond) failures++;
}
function near(a, b) { return Math.abs(a - b) < 0.51; }

async function newApp() {
    const ring = await RingScript.load(bytes, { onOutput: () => {} });
    const r = ring.eval(source);
    if (!r.ok) throw new Error("orders.ring failed to load: " + r.error);
    const call = (fn, arg) => {
        const out = ring.call(fn, arg === undefined ? 1 : arg);
        if (!out.ok) throw new Error(fn + ": " + out.error);
        return typeof out.result === "string" ? JSON.parse(out.result) : out.result;
    };
    call("RefLoad", reference);
    return { ring, call };
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
        const { call } = await newApp();
        // C-102: limit 400,000, balance 355,000 -> only 45,000 of headroom
        call("OrderStart", "C-102");
        call("OrderAddLine", { sku: "SKU-001", qty: 10 });
        const v = call("OrderView");
        check("headroom computed from local data", v.headroom === 45000, String(v.headroom));
        check("an order beyond the limit is blocked", v.blocked === 1,
              "total " + Math.round(v.total));
        const saved = call("OutboxAdd");
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
        const { call } = await newApp();
        call("OrderStart", "C-101");
        call("OrderAddLine", { sku: "SKU-002", qty: 6 });
        const one = call("OutboxAdd");
        check("the order is queued with a device-made id", one.ok === 1 && /^REP-014-\d+$/.test(one.id), one.id);

        call("OrderStart", "C-103");
        call("OrderAddLine", { sku: "SKU-005", qty: 5 });
        const two = call("OutboxAdd");
        check("ids are unique per order", two.id !== one.id, one.id + " / " + two.id);
        check("two orders waiting", call("AppStats").pending === 2);

        // the balance moved locally, before any server heard of it
        const found = call("CustomerFind", "Bonkoukou");
        check("the customer's balance already reflects the order",
              found[0][5] > 240000, "balance now " + found[0][5]);
    }

    /* ---------------------------------------------------------------- */
    console.log("\nSync — per order, so one rejection cannot lose the rest");
    {
        const { call } = await newApp();
        call("OrderStart", "C-101");
        call("OrderAddLine", { sku: "SKU-002", qty: 6 });
        const a = call("OutboxAdd");
        call("OrderStart", "C-109");
        call("OrderAddLine", { sku: "SKU-004", qty: 24 });
        const b = call("OutboxAdd");

        const payload = call("SyncPayload");
        check("the payload carries both orders", payload.count === 2, String(payload.count));
        check("it names the device and the catalogue it priced against",
              payload.device === "REP-014" && payload.catalogue === "2026-08-09");

        call("SyncMarkSent");
        const applied = call("SyncApplyResult", JSON.stringify({
            results: [
                { id: a.id, status: "accepted", note: "" },
                { id: b.id, status: "rejected", note: "customer account on hold" }
            ]
        }));
        check("one accepted, one rejected", applied.accepted === 1 && applied.rejected === 1);
        check("nothing is left queued", applied.still_queued === 0);

        const list = call("OutboxList");
        const rejected = list.find(r => r[0] === b.id);
        check("the rejection keeps the server's reason",
              rejected[4] === "customer account on hold", rejected[4]);

        // and the credit taken by the rejected order is handed back
        const c109 = call("CustomerFind", "Zinder");
        check("credit is returned when an order is rejected",
              c109[0][5] === 12000, "balance " + c109[0][5]);
    }

    /* ---------------------------------------------------------------- */
    console.log("\nA send that never arrived is not a send");
    {
        const { call } = await newApp();
        call("OrderStart", "C-101");
        call("OrderAddLine", { sku: "SKU-002", qty: 6 });
        call("OutboxAdd");
        call("SyncMarkSent");
        const back = call("SyncRollback");
        check("the order goes back to pending and will be retried", back === 1);
        check("and is in the next payload again", call("SyncPayload").count === 1);
    }

    /* ---------------------------------------------------------------- */
    console.log("\nPersistence — a closed tab is not a lost day");
    {
        const first = await newApp();
        first.call("OrderStart", "C-101");
        first.call("OrderAddLine", { sku: "SKU-001", qty: 10 });
        const made = first.call("OutboxAdd");
        const blob = first.ring.call("StateExport", 1).result;

        // a brand new VM, as if the tab had been closed and reopened
        const second = await newApp();
        check("the fresh instance starts empty", second.call("AppStats").orders === 0);
        const restored = second.call("StateImport", blob);
        check("the queue comes back", restored.restored === 1 && restored.pending === 1);
        const list = second.call("OutboxList");
        check("with the same id, so a retry cannot double-book",
              list[0][0] === made.id, list[0][0] + " vs " + made.id);
        const cust = second.call("CustomerFind", "Bonkoukou");
        check("and the credit already committed is remembered",
              cust[0][5] > 240000, "balance " + cust[0][5]);
    }

    console.log("\n" + (failures ? failures + " failure(s)" : "All checks passed."));
    process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
