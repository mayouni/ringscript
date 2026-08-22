/*
** app.js -- the wires, and nothing else.
**
** Every decision is asked of tickets.ring; everything durable is the
** ringscript-pwa library's. This file fetches, renders, and listens.
** The "server" is simulated in the page so the tutorial runs from a
** folder with no back end -- its two-line surface (send one entry,
** answer accepted) is exactly what a real endpoint would implement.
*/
(function () {
"use strict";

var RUNTIME = "../../playground/";
var $ = function (id) { return document.getElementById(id); };
var ring = null, pwa = null, online = true;

/* --- the pretend till. Real life: one POST endpoint, same shape. ---- */
function send(payload) {
    if (!online) { return Promise.reject(new Error("till unreachable")); }
    return new Promise(function (r) { setTimeout(r, 250); });
}

function ask(fn, arg) {
    var r = ring.call(fn, arg === undefined ? 1 : arg);
    if (!r.ok) { log("Ring error in " + fn + ": " + r.error); return null; }
    return typeof r.result === "string" ? JSON.parse(r.result) : r.result;
}

/* ------------------------------------------------------- rendering */
function render() {
    if (!pwa) { return; }

    /* The banner contract: a named state or nothing -- never a spinner.
       NETWORK-LOST / ALONE / STORAGE-FULL come from the library; the
       page only translates them for the person holding the pad. */
    var b = pwa.banner();
    var words = {
        "NETWORK-LOST": "Till unreachable — tickets queue on this pad and send themselves when it returns",
        "ALONE": "Working alone — nothing has answered yet; tickets queue on this pad",
        "STORAGE-FULL": "This pad's storage is full — no more tickets can be taken safely",
        "STORAGE-PINNED-TO-ADDRESS": "Warning: this pad's storage is pinned to a network address that can change"
    };
    $("banner").textContent = b ? words[b] || b : "";
    $("banner").hidden = !b;

    var age = pwa.oldest();
    $("state").textContent = "rung " + pwa.rung() +
        " · " + pwa.pending() + " waiting" +
        (age > 0 ? " (oldest " + age + "s)" : "");

    var rows = ask("TicketList") || [];
    $("tickets").innerHTML = rows.map(function (t) {
        return "<li class='" + t.state + "'>table " + t.table + " — " + t.item +
               " <b>" + t.state + "</b>" +
               (t.state === "placed"
                 ? " <button data-serve='" + t.id + "'>served</button>" +
                   "<button data-cancel='" + t.id + "'>cancel</button>"
                 : "") + "</li>";
    }).join("");
}

function log(text) {
    $("log").textContent = text;
}

/* --------------------------------------- the three user actions.
   The shape is always the same and it IS the tutorial:
   Ring decides -> the library stores durably -> the UI reports. */
function decide(fn, arg, kind) {
    var r = ask(fn, arg);
    if (!r) { return; }
    if (!r.ok) { log(r.refuse); render(); return; }
    pwa.queue(kind, r.payload).then(function (q) {
        log(q.ok ? "" : q.problem);       /* storage-full is loud, never lost */
        render();
        /* try to deliver NOW; the library's in-flight guard makes this
           safe to call eagerly, and a failure just leaves the entry
           queued and starts the 8-second silence clock */
        if (q.ok) { pwa.flush().then(render, render); }
    });
}

/* ------------------------------------------------------------ boot */
async function boot() {
    var wasm = await (await fetch(RUNTIME + "ringscript.wasm")).arrayBuffer();
    ring = await RingScript.load(wasm, { onOutput: function () {} });

    pwa = await Pwa.attach(ring, {
        world:  "cafe-tickets",     /* the storage identity — never the URL */
        device: "pad-1",
        sw: "sw.js",
        send: send,
        onChange: render
    });

    var rules = ring.eval(await (await fetch("tickets.ring")).text());
    if (!rules.ok) { log("tickets.ring: " + rules.error); return; }

    $("place").addEventListener("submit", function (e) {
        e.preventDefault();
        decide("TicketPlace",
               { table: $("table-no").value, item: $("item").value.trim() },
               "ticket");
        $("item").value = "";
    });
    $("tickets").addEventListener("click", function (e) {
        var s = e.target.getAttribute("data-serve");
        var c = e.target.getAttribute("data-cancel");
        if (s) { decide("TicketServe", s, "transition"); }
        if (c) { decide("TicketCancel", c, "transition"); }
    });
    $("cut").addEventListener("click", function () {
        online = !online;
        $("cut").textContent = online ? "Cut the connection" : "Restore the connection";
        if (online) { pwa.flush(); }
        render();
    });

    /* the pretend till answers, so the rung reaches "streaming" the same
       way it would in production: by an observed successful exchange */
    pwa.flush();
    render();
}

var s = document.createElement("script");
s.src = RUNTIME + "ringscript.js";
s.onload = boot;
s.onerror = function () { log("no runtime at " + RUNTIME); };
document.head.appendChild(s);
})();
