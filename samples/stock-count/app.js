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
var OUTBOX_CACHE = "stock-count-v1-outbox";

var $ = function (id) { return document.getElementById(id); };
var ring = null;
var online = true;
var swReg = null;
var deferredInstall = null;

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
        cell(ask("StockStillQueued", 0), "waiting to send");
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
    var o = ask("StockOutbox", 0);
    $("outbox").innerHTML = o.length === 0
        ? '<li class="empty">Nothing waiting.</li>'
        : o.map(function (e) {
            return '<li class="out out--' + e.state + '"><b>' + esc(e.counted_by) + "</b>" +
                   "<span>" + e.lines + " lines · " + e.state + "</span></li>";
        }).join("");
}

function renderAll() { renderStats(); renderSheet(); renderWorst(); renderOutbox(); save(); }

/* ===================================================================
   Storage — the page's job, not Ring's
   =================================================================== */

function save() {
    try { localStorage.setItem(STORAGE_KEY, ring.call("StockSnapshot", 0).result); }
    catch (e) { /* a full or private-mode store is not fatal */ }
}

/* What the service worker will send if the app is closed. Written to the
   Cache API because a worker cannot read localStorage. */
function publishPending() {
    if (!window.caches) { return Promise.resolve(); }
    var queued = ask("StockOutbox", 0).filter(function (e) { return e.state === "queued"; });
    var payloads = queued.map(function (e) { return ask("StockPayload", e.id); });
    return caches.open(OUTBOX_CACHE).then(function (c) {
        return c.put("pending", new Response(JSON.stringify(payloads),
            { headers: { "Content-Type": "application/json" } }));
    });
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
    var q = ask("StockQueue", $("who").value || "unknown");
    if (!q.ok) { log("bad", esc(q.problem)); return; }
    log("queue", "Queued <b>" + esc(q.id) + "</b> — " + q.lines + " lines, on the device.");
    renderAll();
    publishPending().then(registerSync);
}

/* Ask the browser to flush the outbox later, even if this tab is gone.
   Where Background Sync is missing (Safari today) the app falls back to
   flushing on the online event, which needs the tab open — so the feature
   degrades rather than disappears. */
function registerSync() {
    if (swReg && "sync" in swReg) {
        return swReg.sync.register("flush-counts").then(function () {
            log("sync", "Handed to the browser: it will send this when a connection returns, app open or not.");
        }).catch(function () { /* permission or policy; the manual path still works */ });
    }
    log("note", "Background Sync is unavailable here — the outbox flushes when the app is open and online.");
    return Promise.resolve();
}

function syncNow() {
    var queued = ask("StockOutbox", 0).filter(function (e) { return e.state === "queued"; });
    if (queued.length === 0) { log("note", "Nothing waiting."); return; }
    if (!online) { log("bad", "Still offline — the count stays queued."); return; }

    queued.forEach(function (e) {
        var payload = ask("StockPayload", e.id);
        Server.send(payload).then(function (r) {
            ask("StockSent", e.id);
            log("sent", "Sent <b>" + esc(e.id) + "</b> — " + r.bytes + " bytes over the wire.");
            renderAll();
            publishPending();
        }).catch(function () {
            ask("StockRollback", e.id);
            log("bad", "Send failed — <b>" + esc(e.id) + "</b> put back in the queue.");
            renderAll();
        });
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
   Install
   =================================================================== */

window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredInstall = e;
    $("install").hidden = false;
});
window.addEventListener("appinstalled", function () {
    $("install").hidden = true;
    log("install", "Installed. It now opens from the home screen with no network.");
});

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

    $("entry").addEventListener("submit", record);
    $("finish").addEventListener("click", finish);
    $("sync").addEventListener("click", syncNow);
    $("toggle").addEventListener("click", function () {
        setWire(!online, online ? "Cut by hand — everything below still works."
                                : "Back. Anything queued can be sent.");
        if (online) { syncNow(); }
    });
    $("install-go").addEventListener("click", function () {
        if (!deferredInstall) { return; }
        deferredInstall.prompt();
        deferredInstall = null;
        $("install").hidden = true;
    });

    window.addEventListener("online", function () {
        setWire(true, "The browser reports a connection.");
        syncNow();
    });
    window.addEventListener("offline", function () {
        setWire(false, "The browser reports no connection — keep counting.");
    });

    setWire(navigator.onLine, navigator.onLine
        ? "The server is reachable." : "No connection — keep counting.");
    renderAll();
}

/* The service worker is what makes this installable and offline-capable.
   Registered after boot so a failure here cannot stop the app working. */
function registerWorker() {
    if (!("serviceWorker" in navigator)) {
        log("note", "No service worker here — the app runs, but will not install or work offline.");
        return;
    }
    navigator.serviceWorker.register("sw.js").then(function (reg) {
        swReg = reg;
        log("install", "Service worker registered. The runtime and rules are cached — the next open needs no network.");
    }).catch(function (e) {
        log("bad", "Service worker refused: " + esc(e.message) + " (it needs https or localhost).");
    });

    navigator.serviceWorker.addEventListener("message", function (e) {
        if (!e.data || !ring) { return; }
        if (e.data.type === "sent") { ask("StockSent", e.data.id); log("sent", "Sent in the background: <b>" + esc(e.data.id) + "</b>"); }
        if (e.data.type === "failed") { ask("StockRollback", e.data.id); log("bad", "Background send failed — still queued."); }
        renderAll();
    });
}

var s = document.createElement("script");
s.src = RUNTIME + "ringscript.js";
s.onload = function () { boot().then(registerWorker); };
s.onerror = function () { log("bad", "Could not load the runtime from " + RUNTIME); };
document.head.appendChild(s);
