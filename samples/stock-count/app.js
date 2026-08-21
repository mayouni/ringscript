/*
** Stock Count — the wires.
**
** This file does the things a browser does: fetch, the DOM, storage, the
** service worker, the install prompt. It makes no business decisions. Every
** "is this variance serious", "may this count be submitted", "what is the
** net value" comes back from count.ring.
**
** Read it alongside count.ring and the division is the whole point of the
** sample: about 300 lines of wiring here, and the rules over there, where
** they can be read by someone who does not write JavaScript.
*/

/* Two files, wherever you put them. In this repository the runtime is
   shared by every sample; in your project it would sit beside the app. */
var RUNTIME = "../../playground/";
var STORAGE_KEY = "ringscript.sample.stock-count.v1";

var $ = function (id) { return document.getElementById(id); };
var ring = null;
var online = true;
var pwa = null;

/* ===================================================================
   Ring
   =================================================================== */

function ask(fn, arg) {
    var r = ring.call(fn, arg === undefined ? 1 : arg);
    if (!r.ok) { throw new Error(fn + ": " + r.error); }
    return typeof r.result === "string" ? JSON.parse(r.result) : r.result;
}

/* ===================================================================
   The "server". One endpoint, called at most twice a shift.
   =================================================================== */

var Server = {
    reference: function () {
        /* Cached by the service worker, so this succeeds offline too after
           the first shift — which is the difference between an app that
           starts and one that shows a spinner. */
        return fetch("expected.json").then(function (r) { return r.json(); });
    },
    send: function (payload) {
        if (!online) { return Promise.reject(new Error("offline")); }
        /* No server in a static sample. Everything up to the request is
           real; this stands in for the POST. */
        return new Promise(function (res) { setTimeout(res, 260); })
            .then(function () { return { ok: true, bytes: JSON.stringify(payload).length }; });
    }
};

/* ===================================================================
   Small helpers
   =================================================================== */

function money(n) { return (n < 0 ? "-" : "") + Math.abs(n).toLocaleString("en-US") + " F"; }
function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
}
function log(kind, html) {
    var li = document.createElement("li");
    li.className = "log__" + kind;
    li.innerHTML = html;
    var l = $("log");
    l.insertBefore(li, l.firstChild);
    while (l.children.length > 14) { l.removeChild(l.lastChild); }
}

/* ===================================================================
   Rendering — every number here came from Ring
   =================================================================== */

function renderStats() {
    var p = ask("StockProgress", 0);
    $("stats").innerHTML =
        cell(p.counted + " / " + p.items, "items counted") +
        cell(p.flagged, "need investigating") +
        cell(money(p.net_value), "net variance") +
        cell(pwa.pending(), "waiting to send");
    $("finish-hint").textContent = p.remaining > 0
        ? p.remaining + " item" + (p.remaining === 1 ? "" : "s") + " still to count."
        : "Every item is counted. This can be queued.";
    return p;
}
function cell(big, small) {
    return '<div class="stat"><b>' + esc(big) + "</b><span>" + esc(small) + "</span></div>";
}

function renderSheet() {
    var rows = ask("StockSheet", 0);
    var sel = $("sku"), keep = sel.value, opts = "";
    var body = "";
    rows.forEach(function (r) {
        var counted = r[4] ? r[3] : "—";
        var variance = !r[4] ? "" : (r[5] === 0 ? "0" : (r[5] > 0 ? "+" + r[5] : r[5]));
        var cls = !r[4] ? "" : (r[5] === 0 ? "ok" : (r[5] < 0 ? "short" : "over"));
        body += "<tr><td>" + esc(r[1]) + '<small>' + esc(r[0]) + "</small></td>" +
                '<td class="num">' + r[2] + "</td>" +
                '<td class="num">' + counted + "</td>" +
                '<td class="num ' + cls + '">' + variance + "</td></tr>";
        opts += '<option value="' + esc(r[0]) + '">' + esc(r[1]) + "</option>";
    });
    $("sheet").querySelector("tbody").innerHTML = body;
    sel.innerHTML = opts;
    if (keep) { sel.value = keep; }
}

function renderWorst() {
    var w = ask("StockDiscrepancies", 5);
    $("worst").innerHTML = w.length === 0
        ? '<li class="empty">Nothing off yet.</li>'
        : w.map(function (d) {
            return "<li><b>" + esc(d.name) + "</b>" +
                   '<span class="' + (d.variance < 0 ? "short" : "over") + '">' +
                   (d.variance > 0 ? "+" + d.variance : d.variance) + " · " +
                   money(d.variance_value) + "</span></li>";
        }).join("");
}

function renderOutbox() {
    var o = pwa.list();
    $("outbox").innerHTML = o.length === 0
        ? '<li class="empty">Nothing waiting.</li>'
        : o.map(function (e) {
            return '<li class="out out--' + e.state + '"><b>' + esc(e.kind) + "</b>" +
                   "<span>" + esc(e.id) + " · " + e.state + "</span></li>";
        }).join("");
}

function renderAll() {
    renderStats(); renderSheet(); renderWorst(); renderOutbox(); save();
    $("install").hidden = !pwa.install.available;
}

/* ===================================================================
   Storage — the page's job, not Ring's
   =================================================================== */

function save() {
    try { localStorage.setItem(STORAGE_KEY, ring.call("StockSnapshot", 0).result); }
    catch (e) { /* a full or private-mode store is not fatal */ }
}

/* ===================================================================
   Actions
   =================================================================== */

function record(e) {
    e.preventDefault();
    var sku = $("sku").value;
    var qty = $("qty").value;
    var v = ask("StockCount", JSON.stringify([["sku", sku], ["counted", qty === "" ? "" : Number(qty)]]));
    var box = $("verdict");
    box.hidden = false;
    if (!v.ok) {
        box.className = "verdict verdict--bad";
        box.textContent = v.problem;
        return;
    }
    box.className = "verdict verdict--" + v.verdict;
    box.textContent = v.verdict === "match"
        ? v.name + ": counts exactly."
        : v.name + ": " + (v.variance > 0 ? "+" + v.variance : v.variance) +
          " (" + money(v.variance_value) + ")" +
          (v.verdict === "investigate" ? " — worth investigating." : "");
    $("qty").value = "";
    renderAll();
}

function finish() {
    /* Ring decides whether the count MAY be submitted -- that is a stock
       rule. The library decides what queueing means. */
    var q = ask("StockFinish", $("who").value || "unknown");
    if (!q.ok) { log("bad", esc(q.problem)); return; }

    /* queue() answers a Promise in pwa 2.0: durable before ok, and a full
       store refuses by name instead of losing the count */
    pwa.queue("count", q).then(function (r) {
        if (!r.ok) { log("bad", esc(r.problem)); return; }
        log("queue", "Queued <b>" + esc(r.id) + "</b> — " + q.items + " lines, on the device.");
        renderAll();
    });
}

function syncNow() {
    if (pwa.pending() === 0) { log("note", "Nothing waiting."); return; }
    if (!online) { log("bad", "Still offline — the count stays queued."); return; }
    pwa.flush().then(function (results) {
        results.forEach(function (r) {
            if (r.sent) { log("sent", "Sent <b>" + esc(r.id) + "</b>"); }
            else { log("bad", "Send failed — <b>" + esc(r.id) + "</b> put back in the queue."); }
        });
        renderAll();
    });
}

function setWire(up, why) {
    online = up;
    $("wire").className = "wire " + (up ? "wire--up" : "wire--down");
    $("wire-state").textContent = "Connection: " + (up ? "up" : "down");
    $("wire-said").textContent = why;
    $("toggle").textContent = up ? "Cut the connection" : "Restore the connection";
}

/* ===================================================================
   Boot
   =================================================================== */

async function boot() {
    log("note", "Loading the Ring runtime…");

    var wasm = await (await fetch(RUNTIME + "ringscript.wasm")).arrayBuffer();
    var src = await (await fetch("count.ring")).text();
    ring = await RingScript.load(wasm, { onOutput: function () {} });
    var ev = ring.eval(src);
    if (!ev.ok) { log("bad", "count.ring failed: " + esc(ev.error)); return; }

    var ref = await Server.reference();
    var n = ring.call("StockLoad", JSON.stringify(ref)).result;
    log("wire", "Pulled " + n + " items once. From here on the device decides.");

    var saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (saved) {
        ring.call("StockRestore", saved);
        log("note", "Restored the session from the last time this app was open.");
    }

    /* Everything a PWA needs -- service worker, install prompt, connection,
       the outbox and its storage, Background Sync -- in one call. This
       replaced about eighty lines of this file and all of sw.js but its
       cache list. See lib/pwa/. */
    pwa = await Pwa.attach(ring, {
        world: "stock-count",                   /* the storage identity (2.0) */
        device: $("who").value || "device",
        sw: "sw.js",
        storageKey: STORAGE_KEY + ".outbox",    /* so a 1.x queue imports once */
        syncTag: "pwa-flush",
        send: Server.send,
        onChange: function () { if (pwa) { renderAll(); } }
    });

    if (pwa.swError) {
        log("bad", "Service worker refused: " + esc(pwa.swError) + " (it needs https or localhost).");
    } else if (pwa.registration) {
        log("install", "Service worker registered. The runtime and rules are cached — the next open needs no network.");
    } else {
        log("note", "No service worker here — the app runs, but will not install or work offline.");
    }

    $("entry").addEventListener("submit", record);
    $("finish").addEventListener("click", finish);
    $("sync").addEventListener("click", syncNow);
    $("toggle").addEventListener("click", function () {
        setWire(!online, online ? "Cut by hand — everything below still works."
                                : "Back. Anything queued can be sent.");
        if (online) { syncNow(); }
    });
    $("install-go").addEventListener("click", function () {
        pwa.install.prompt().then(function (accepted) {
            if (accepted) {
                log("install", "Installed. It now opens from the home screen with no network.");
            }
        });
    });

    window.addEventListener("online", function () {
        setWire(true, "The browser reports a connection.");
    });
    window.addEventListener("offline", function () {
        setWire(false, "The browser reports no connection — keep counting.");
    });

    setWire(navigator.onLine, navigator.onLine
        ? "The server is reachable." : "No connection — keep counting.");
    renderAll();
}

var s = document.createElement("script");
s.src = RUNTIME + "ringscript.js";
s.onload = boot;
s.onerror = function () { log("bad", "Could not load the runtime from " + RUNTIME); };
document.head.appendChild(s);
