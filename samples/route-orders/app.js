/*
** app.js — the wires.
**
** This file does what front-end code has always done: fetch, storage, DOM,
** event handlers. What it deliberately does NOT do is decide anything. It
** never works out a price, applies a discount, computes a tax, or judges
** whether a customer may take more credit. Every one of those questions is
** asked of orders.ring and answered there.
**
** The division is worth stating plainly, because it is the whole point of
** the sample:
**
**     index.html + app.css   what the application looks like
**     app.js                 how it talks to the browser and the network
**     orders.ring            what the application MEANS
**
** If you rewrite this file in React, Vue or Svelte tomorrow, orders.ring
** does not change — and neither does your back end.
*/
(function () {
"use strict";

/* Where the runtime lives. Two files: ringscript.js and ringscript.wasm.
   Copy them next to this sample and set this to "" to make the folder
   entirely self-contained. */
var RUNTIME = "../../playground/";

/* The key this sample stores its work under. */
var STORAGE_KEY = "ringscript.sample.route-orders.v1";

var $ = function (id) { return document.getElementById(id); };
var ring = null;
var pwa = null;
var online = true;
var selectedCustomer = null;
var localActions = 0, wireCalls = 0, wireBytes = 0;

/* ===================================================================
   Talking to Ring
   ------------------------------------------------------------------
   One helper. Everything the application means goes through here, and
   what comes back is ordinary JSON.
   =================================================================== */
function ask(fn, arg) {
    var r = ring.call(fn, arg === undefined ? 1 : arg);
    if (!r.ok) { log("fail", "Ring error in " + fn + ": " + r.error); return null; }
    return typeof r.result === "string" ? JSON.parse(r.result) : r.result;
}

/* ===================================================================
   The server
   ------------------------------------------------------------------
   Two endpoints. Here the first is a static JSON file and the second is
   answered in the page, so the sample runs with no back end at all — but
   the shape is exactly what your own server would implement, in whatever
   language you already use. Both refuse while the connection is down.
   =================================================================== */
var Server = {
    /* GET /reference */
    reference: function () {
        if (!online) return Promise.reject(new Error("offline"));
        return fetch("reference.json").then(function (r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.text();
        });
    },
    /* POST /orders — answers PER ORDER, never for the batch as a whole */
    submit: function (payloadText) {
        if (!online) return Promise.reject(new Error("offline"));
        var batch = JSON.parse(payloadText);
        /* The library's batch shape: { device, count, entries: [ { id,
           kind, payload } ] }. A real server would read the same thing. */
        var results = (batch.entries || []).map(function (e) {
            /* one deliberate business rejection, so the reconciliation path
               is exercised rather than described */
            if (e.payload && e.payload.customer === "C-106") {
                return { id: e.id, status: "rejected",
                         note: "account on hold — settle the balance first" };
            }
            return { id: e.id, status: "accepted", note: "" };
        });
        return new Promise(function (resolve) {
            setTimeout(function () { resolve(JSON.stringify({ results: results })); }, 350);
        });
    }
};

/* ===================================================================
   Presentation helpers
   =================================================================== */
function money(n) {
    return Math.round(n).toLocaleString("en-US").replace(/,/g, " ");
}
function esc(s) {
    return String(s === undefined || s === null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
}

function log(kind, html) {
    var d = new Date();
    var t = ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2) +
            ":" + ("0" + d.getSeconds()).slice(-2);
    var label = kind === "local" ? "on the device"
              : kind === "fail" ? "no network" : "over the wire";
    var li = el("li", null,
        "<time>" + t + "</time><b class='is-" + kind + "'>" + label + "</b> — " + html);
    $("log").insertBefore(li, $("log").firstChild);
    while ($("log").children.length > 60) $("log").removeChild($("log").lastChild);
}

/* ===================================================================
   Rendering — reads answers, decides nothing
   =================================================================== */
function renderStats() {
    var s = ask("AppStats");
    if (!s || !pwa) return;
    /* The catalogue numbers are Ring's; the queue numbers are the
       library's. Neither has to know about the other. */
    var q = pwa.list().filter(function (e) { return e.state === "queued" || e.state === "sent"; });
    var held = q.reduce(function (n, e) { return n + payloadOf(e.id).total; }, 0);
    $("stats").innerHTML =
        cell(s.customers, "shops on the route") +
        cell(s.products, "products in the catalogue") +
        cell(q.length, "orders waiting to go") +
        cell(money(held) + " " + s.currency, "value held on the device") +
        cell(localActions, "actions that needed no network") +
        cell(wireCalls + " · " + Math.round(wireBytes / 1024) + " KB", "times the wire was used");
}

/* The library keeps the payload it was handed; this reads it back. Those
   Ring functions are the library's declared surface, so calling them is
   as legitimate as calling its JavaScript. */
function payloadOf(id) {
    var r = ask("PwaOutboxPayload", id);
    return (r && r.ok) ? r.payload : { total: 0, customer_name: "" };
}

function cell(big, small) {
    return "<div><b>" + esc(big) + "</b><span>" + esc(small) + "</span></div>";
}

function renderCustomers() {
    var rows = ask("CustomerFind", $("customer-search").value.trim()) || [];
    var tb = $("customers").tBodies[0];
    tb.innerHTML = "";
    rows.forEach(function (r) {
        var tr = el("tr", null,
            "<td>" + esc(r[1]) + "</td><td>" + esc(r[2]) + "</td>" +
            "<td>" + esc(r[3]) + "</td><td class='num'>" + money(r[6]) + "</td>");
        tr.setAttribute("data-pick", "");
        if (r[0] === selectedCustomer) tr.setAttribute("aria-selected", "true");
        tr.addEventListener("click", function () { pickCustomer(r[0], r[1]); });
        tb.appendChild(tr);
    });
}

function renderProducts() {
    var rows = ask("ProductFind", $("product-search").value.trim()) || [];
    var tb = $("products").tBodies[0];
    tb.innerHTML = "";
    rows.forEach(function (r) {
        var tr = el("tr", null,
            "<td>" + esc(r[1]) + "</td><td class='num'>" + r[3] + " " + esc(r[2]) + "</td>" +
            "<td class='num'>" + r[4] + "</td><td class='num'>" + money(r[5]) + "</td>");
        tr.setAttribute("data-pick", "");
        tr.addEventListener("click", function () { addLine(r[0]); });
        tb.appendChild(tr);
    });
}

function renderOrder() {
    var tb = $("lines").tBodies[0];
    tb.innerHTML = "";
    if (!selectedCustomer) {
        $("order-summary").innerHTML = "<p class='note'>Pick a shop above to start an order.</p>";
        return;
    }
    var v = ask("OrderView");
    if (!v) return;

    v.lines.forEach(function (l, i) {
        var flag = l[7] ? " <span class='verdict verdict--bad'>· " + esc(l[7]) + "</span>" : "";
        var tr = el("tr", null,
            "<td>" + esc(l[1]) + flag + "</td>" +
            "<td class='num'>" + l[2] + "</td>" +
            "<td class='num'>" + money(l[4]) + "</td>" +
            "<td class='num'>" + (l[5] ? l[5] + "%" : "—") + "</td>" +
            "<td class='num'>" + money(l[6]) + "</td>" +
            "<td class='num'><button type='button' class='btn btn--quiet'>remove</button></td>");
        tr.querySelector("button").addEventListener("click", function () {
            ask("OrderRemoveLine", i + 1);
            localActions++;
            renderOrder(); renderStats();
        });
        tb.appendChild(tr);
    });

    var used = v.balance + v.total;
    var pct = v.credit_limit > 0 ? Math.min(100, Math.round(used / v.credit_limit * 100)) : 0;
    var html =
        "<div class='totals'><span>Subtotal</span><b>" + money(v.subtotal) + " " + esc(v.currency) + "</b></div>" +
        "<div class='totals'><span>Tax at " + Math.round(v.tax_rate * 100) + "%</span><b>" + money(v.tax) + "</b></div>" +
        "<div class='totals totals--grand'><span>Total</span><b>" + money(v.total) + " " + esc(v.currency) + "</b></div>" +
        "<div class='credit'>" +
          "<div class='totals'><span>" + esc(v.customer_name) + " — tier " + esc(v.tier) +
            ", credit used after this order</span><b>" + money(used) + " / " + money(v.credit_limit) + "</b></div>" +
          "<div class='meter" + (v.blocked ? " meter--over" : "") + "'><span style='width:" + pct + "%'></span></div>" +
          "<p class='verdict " + (v.blocked ? "verdict--bad" : "verdict--ok") + "'>" +
            (v.blocked ? "Over the credit limit — the office must approve this one"
                       : money(v.headroom - v.total) + " " + esc(v.currency) + " of credit would remain") +
          "</p>" +
        "</div>";
    if (v.warnings.length) {
        html += "<div class='warnings'>" + v.warnings.map(esc).join("<br>") + "</div>";
    }
    html += "<div class='actions'><button type='button' class='btn' id='queue'" +
            (v.lines.length && !v.blocked ? "" : " disabled") + ">Queue this order</button></div>" +
            "<p class='note'>Every figure above was decided on the device. " +
            "No request was made to produce this screen.</p>";
    $("order-summary").innerHTML = html;

    var q = $("queue");
    if (q) q.addEventListener("click", queueOrder);
}

function renderOutbox() {
    var rows = pwa ? pwa.list() : [];
    var tb = $("outbox").tBodies[0];
    tb.innerHTML = "";
    rows.slice().reverse().forEach(function (e) {
        var p = payloadOf(e.id);
        var note = e.note ? " — " + esc(e.note) : "";
        tb.appendChild(el("tr", null,
            "<td>" + esc(e.id) + "<br><span class='note'>" + esc(p.customer_name) + note + "</span></td>" +
            "<td class='num'>" + money(p.total) + "</td>" +
            "<td><span class='pill pill--" + esc(e.state) + "'>" + esc(e.state) + "</span></td>"));
    });
    $("send").disabled = !pwa || pwa.pending() === 0;
}

function renderAll() {
    renderCustomers(); renderProducts(); renderOrder(); renderOutbox(); renderStats();
}

/* ===================================================================
   Actions — each one asks Ring, then redraws
   =================================================================== */
function pickCustomer(id, name) {
    selectedCustomer = id;
    ask("OrderStart", id);
    localActions++;
    log("local", "Started an order for <b>" + esc(name) + "</b> — prices and credit read from the device.");
    renderAll();
}

function addLine(sku) {
    if (!selectedCustomer) { log("local", "Pick a shop first."); return; }
    var qty = parseInt($("qty").value, 10) || 1;
    var r = ask("OrderAddLine", { sku: sku, qty: qty });
    localActions++;
    if (r && r.ok) {
        log("local", "Added " + qty + " × " + esc(sku) + " — priced, discounted and taxed by Ring.");
    } else if (r) {
        log("local", "Refused: " + esc(r.error));
    }
    renderOrder(); renderStats();
}

function queueOrder() {
    var r = ask("OrderFinish");
    localActions++;
    if (!r) return;
    if (!r.ok) { log("local", "Not queued: " + esc(r.error)); renderOrder(); return; }

    /* queue() answers a Promise in pwa 2.0: the entry is DURABLE before ok,
       and a store that cannot hold it says so instead of losing it */
    pwa.queue("order", r.payload).then(function (q) {
        if (!q.ok) { log("bad", "Not queued: " + esc(q.problem)); renderAll(); return; }
        log("local", "Order <b>" + esc(q.id) + "</b> queued for " + money(r.total) +
            " — written to storage, not to the network.");
        selectedCustomer = null;
        save();
        renderAll();
    });
}

function pullReference() {
    log("wire", "Requesting the reference data…");
    Server.reference().then(function (text) {
        wireCalls++; wireBytes += text.length;
        ask("RefLoad", text);
        log("wire", "Received the catalogue and the customer file — <b>" +
            Math.round(text.length / 1024) + " KB</b>, once. Nothing else will be fetched.");
        var kept = localStorage.getItem(STORAGE_KEY);
        if (kept) ask("StateImport", kept);
        renderAll();
    }).catch(function (e) {
        log("fail", "The reference data could not be fetched (" + esc(e.message) +
            "). The application keeps whatever it already has.");
    });
}

function send() {
    if (!pwa || pwa.pending() === 0) return;
    $("send").disabled = true;

    /* One request for the whole route, and the server answers per order.
       Ten separate requests would be ten chances to fail on this link. */
    pwa.flushBatch(function (batch) {
        var text = JSON.stringify(batch);
        wireCalls++; wireBytes += text.length;
        log("wire", "Sending <b>" + batch.count + "</b> order(s), " +
            Math.round(text.length / 1024 * 10) / 10 + " KB.");
        renderOutbox();
        return Server.submit(text).then(function (answer) {
            wireBytes += answer.length;
            return JSON.parse(answer);
        });
    }).then(function (applied) {
        if (!applied) return;
        log("wire", "The server answered per order: <b>" + applied.accepted +
            " accepted</b>, " + applied.rejected + " rejected. " +
            applied.still_queued + " still queued.");

        /* A refusal has a consequence only this application knows: the
           order did not happen, so the credit goes back. */
        if (applied.rejected) {
            var giveBack = pwa.list()
                .filter(function (e) { return e.state === "rejected"; })
                .map(function (e) {
                    var p = payloadOf(e.id);
                    return [["customer", p.customer], ["total", p.total]];
                });
            ask("CreditReturn", JSON.stringify(giveBack));
            log("local", "The rejected order kept its reason and gave its credit back — " +
                "decided here, from the answer.");
        }
        save();
        renderAll();
    }).catch(function (e) {
        log("fail", "The send did not arrive (" + esc(e.message) + "). " +
            "The whole batch went back to pending and will be tried again. Nothing was lost.");
        save();
        renderAll();
    });
}

/* Ring says everything it holds in one JSON string; this file puts that
   string somewhere. Ring has never heard of localStorage. */
function save() {
    var r = ring.call("StateExport", 1);
    if (r.ok) localStorage.setItem(STORAGE_KEY, r.result);
}

function setOnline(v) {
    online = v;
    $("wire").className = "wire wire--" + (v ? "up" : "down");
    $("wire-state").textContent = "Connection: " + (v ? "up" : "down");
    $("wire-said").textContent = v
        ? "The server is reachable."
        : "No network. Keep working: take orders, price them, check credit, queue them. Nothing below degrades.";
    $("toggle").textContent = v ? "Cut the connection" : "Restore the connection";
    log(v ? "wire" : "fail",
        v ? "The connection is back." : "The connection is gone — and the application does not care.");
}

/* ===================================================================
   Start
   =================================================================== */
(async function start() {
    log("local", "Starting the Ring virtual machine in this tab…");
    var wasm = await (await fetch(RUNTIME + "ringscript.wasm")).arrayBuffer();
    ring = await RingScript.load(wasm, { onOutput: function () {} });

    /* the money rules first -- orders.ring prices with ringscript-money,
       so the library's Ring half must be resident before the first
       OrderView. Money.attach loads it from beside its own script. */
    await Money.attach(ring);

    var rules = await (await fetch("orders.ring")).text();
    var loaded = ring.eval(rules);
    if (!loaded.ok) { log("fail", "orders.ring: " + esc(loaded.error)); return; }
    log("local", "orders.ring is resident — " + Math.round(rules.length / 1024) +
        " KB of business rules, now running on the device.");

    /* The outbox, its storage and its ids come from ringscript-pwa. No
       service worker: this sample is about where the RULES live, and
       stock-count is the one about installing. The library is happy
       without one. */
    pwa = await Pwa.attach(ring, {
        world: "route-orders",                  /* the storage identity (2.0) */
        device: "van-3",
        sw: null,
        storageKey: STORAGE_KEY + ".outbox",    /* so a 1.x queue imports once */
        onChange: function () { if (pwa && ring) { renderOutbox(); renderStats(); } }
    });
    log("local", "ringscript-pwa " + Pwa.version + " attached — the queue, its ids and its storage.");

    $("toggle").addEventListener("click", function () { setOnline(!online); });
    $("customer-search").addEventListener("input", function () { localActions++; renderCustomers(); renderStats(); });
    $("product-search").addEventListener("input", function () { localActions++; renderProducts(); renderStats(); });
    $("send").addEventListener("click", send);
    $("pull").addEventListener("click", pullReference);

    pullReference();
})();
})();
