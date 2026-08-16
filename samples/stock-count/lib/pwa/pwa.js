/*
** RingScript PWA — the browser half.
**
** One global, one entry point:
**
**     <script src="lib/pwa/pwa.js"></script>
**     const pwa = await Pwa.attach(ring, { device: "phone-7", send: post });
**
** It loads its own Ring half, so the page never has to fetch and eval
** pwa.ring itself. Everything here is wiring — service worker, install
** prompt, connection, storage, sync. The queue's rules live in pwa.ring.
*/

(function (global) {
    "use strict";

    /* Where this library's own files sit. Derived from this script's src so
       the page can put it anywhere without configuring a path. */
    function ownBase() {
        var s = document.currentScript;
        if (s && s.src) { return s.src.replace(/[^/]*$/, ""); }
        return "lib/pwa/";
    }
    var BASE = ownBase();

    function parse(res, who) {
        if (!res || !res.ok) { throw new Error("pwa: " + who + ": " + (res && res.error)); }
        var v = res.result;
        if (typeof v !== "string") { return v; }
        var t = v.trim();
        if (t.charAt(0) === "{" || t.charAt(0) === "[") {
            try { return JSON.parse(t); } catch (e) { return v; }
        }
        return v;
    }

    global.Pwa = {
        version: "1.1.0",

        /*
        ** ring     a loaded RingScript VM
        ** opts.device      something stable for this device or user
        ** opts.send        (payload) => Promise — how one entry reaches your server
        ** opts.storageKey  where the queue is persisted (default per-origin)
        ** opts.sw          path to the app's service worker, or null to skip
        ** opts.syncTag     Background Sync tag, must match the worker's
        ** opts.onChange    called whenever the queue or the connection changes
        */
        attach: async function (ring, opts) {
            opts = opts || {};
            var send = opts.send || function () { return Promise.reject(new Error("no sender")); };
            var storageKey = opts.storageKey || ("ringscript.pwa." + location.pathname);
            var syncTag = opts.syncTag || "pwa-flush";
            var onChange = opts.onChange || function () {};

            /* 1. the Ring half, loaded by the library rather than the page */
            var src = await (await fetch(BASE + "pwa.ring")).text();
            var ev = ring.eval(src);
            if (!ev.ok) { throw new Error("pwa: pwa.ring failed: " + ev.error); }

            var ask = function (fn, arg) {
                return parse(ring.call(fn, arg === undefined ? 1 : arg), fn);
            };

            ask("PwaOutboxDevice", opts.device || "device");

            /* The in-flight flush, if any. See flush(). */
            var inFlight = null;

            /* 2. anything left over from last time */
            try {
                var saved = localStorage.getItem(storageKey);
                if (saved) { ring.call("PwaOutboxRestore", saved); }
            } catch (e) { /* private mode; the queue is simply not durable */ }

            function save() {
                try { localStorage.setItem(storageKey, ring.call("PwaOutboxSnapshot", 0).result); }
                catch (e) {}
            }

            /* What the service worker will send if the app is closed. A
               worker cannot read localStorage, so the handover goes through
               the Cache API, which both sides can reach. */
            function publish() {
                if (!global.caches) { return Promise.resolve(); }
                var pending = ask("PwaOutboxList", 0).filter(function (e) { return e.state === "queued"; });
                var payloads = pending.map(function (e) { return ask("PwaOutboxPayload", e.id); });
                return caches.open("pwa-outbox").then(function (c) {
                    return c.put("pending", new Response(JSON.stringify(payloads),
                        { headers: { "Content-Type": "application/json" } }));
                });
            }

            var api = {
                /* queue work. The id is made in Ring, before anything is
                   sent, so a retry cannot become a second order. */
                queue: function (kind, payload) {
                    var r = ask("PwaOutboxAdd", JSON.stringify([["kind", kind], ["payload", payload]]));
                    save(); onChange(api);
                    if (r.ok) { publish().then(api.requestSync); }
                    return r;
                },

                /* Try to send everything queued, one entry at a time so a
                   half-successful flush leaves the rest queued.

                   Concurrent callers share one flush. Without this guard two
                   overlapping calls — the online event and a Send button,
                   say — both read the same entry as "queued" and both send
                   it, which is precisely the duplicate this library exists
                   to prevent. Found by clicking both within 100 ms. */
                flush: function () {
                    if (inFlight) { return inFlight; }
                    inFlight = api.flushOnce();
                    var clear = function () { inFlight = null; };
                    inFlight.then(clear, clear);
                    return inFlight;
                },

                flushOnce: function () {
                    var pending = ask("PwaOutboxList", 0).filter(function (e) { return e.state === "queued"; });
                    return Promise.all(pending.map(function (e) {
                        var p = ask("PwaOutboxPayload", e.id);
                        return Promise.resolve(send(p)).then(function () {
                            ask("PwaOutboxSent", e.id);
                            return { id: e.id, sent: true };
                        }).catch(function () {
                            ask("PwaOutboxRollback", e.id);
                            return { id: e.id, sent: false };
                        });
                    })).then(function (results) {
                        save(); publish(); onChange(api);
                        return results;
                    });
                },

                /* Send everything queued as ONE request and let the server
                   answer per entry. Fewer round trips than flush() on a bad
                   link, with the same guarantee: a refused entry is marked
                   refused, and a failed REQUEST rolls the whole batch back.

                   sendBatch(batch) must resolve with
                   { results: [ { id, status, note } ] }. */
                flushBatch: function (sendBatch) {
                    if (inFlight) { return inFlight; }
                    var batch = ask("PwaOutboxBatch", 0);
                    if (batch.count === 0) { return Promise.resolve(null); }
                    ask("PwaOutboxMarkSending", 0);
                    inFlight = Promise.resolve(sendBatch(batch)).then(function (answer) {
                        var summary = ask("PwaOutboxApply", JSON.stringify(answer));
                        save(); publish(); onChange(api);
                        inFlight = null;
                        return summary;
                    }, function (e) {
                        /* the request never arrived: nothing was sent */
                        ask("PwaOutboxRollbackAll", 0);
                        save(); onChange(api);
                        inFlight = null;
                        throw e;
                    });
                    return inFlight;
                },

                pending: function () { return ask("PwaOutboxPending", 0); },
                list: function () { return ask("PwaOutboxList", 0); },
                forget: function () { var n = ask("PwaOutboxForget", 0); save(); onChange(api); return n; },
                online: function () { return navigator.onLine; },

                /* Ask the browser to flush later, even if this tab is gone.
                   Unsupported on some platforms — Safari today — so this is
                   an addition to flush(), never a replacement for it. */
                requestSync: function () {
                    if (!api.registration || !("sync" in api.registration)) { return Promise.resolve(false); }
                    return api.registration.sync.register(syncTag)
                        .then(function () { return true; })
                        .catch(function () { return false; });
                },

                install: { available: false, prompt: function () { return Promise.resolve(false); } },
                registration: null
            };

            /* 3. the service worker: installability and offline */
            if (opts.sw && "serviceWorker" in navigator) {
                try {
                    api.registration = await navigator.serviceWorker.register(opts.sw);
                } catch (e) {
                    /* needs https or localhost; the app still works online */
                    api.swError = e.message;
                }
                navigator.serviceWorker.addEventListener("message", function (e) {
                    if (!e.data) { return; }
                    if (e.data.type === "pwa-sent") { ask("PwaOutboxSent", e.data.id); }
                    if (e.data.type === "pwa-failed") { ask("PwaOutboxRollback", e.data.id); }
                    save(); onChange(api);
                });
            }

            /* 4. the install prompt */
            global.addEventListener("beforeinstallprompt", function (e) {
                e.preventDefault();
                api.install.available = true;
                api.install.prompt = function () {
                    e.prompt();
                    api.install.available = false;
                    return e.userChoice.then(function (c) { return c.outcome === "accepted"; });
                };
                onChange(api);
            });
            global.addEventListener("appinstalled", function () {
                api.install.available = false;
                onChange(api);
            });

            /* 5. the connection */
            global.addEventListener("online", function () { onChange(api); api.flush(); });
            global.addEventListener("offline", function () { onChange(api); });

            onChange(api);
            return api;
        }
    };
})(window);
