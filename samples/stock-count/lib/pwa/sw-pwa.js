/*
** RingScript PWA — the service-worker half.
**
** The app's own sw.js imports this and configures it:
**
**     importScripts("lib/pwa/sw-pwa.js");
**     PwaServiceWorker({
**         cache: "stock-count-v1",
**         shell: [ "./", "./index.html", "./app.js", "./count.ring",
**                  "../../playground/ringscript.js",
**                  "../../playground/ringscript.wasm" ],
**         endpoint: "./api/counts"
**     });
**
** The app decides what is cached — only it knows its own files. This
** decides what caching *means*: install, activate, fetch, and the
** background flush.
*/

function PwaServiceWorker(config) {
    "use strict";

    var CACHE = config.cache;
    var SHELL = config.shell || [];
    var ENDPOINT = config.endpoint;
    var TAG = config.syncTag || "pwa-flush";
    var OUTBOX = "pwa-outbox";

    if (!CACHE) { throw new Error("PwaServiceWorker: a cache name is required"); }

    self.addEventListener("install", function (e) {
        e.waitUntil(
            /* addAll is atomic: one failure caches nothing, which beats a
               half-installed app that opens to a blank page. */
            caches.open(CACHE).then(function (c) { return c.addAll(SHELL); })
                  .then(function () { return self.skipWaiting(); })
        );
    });

    self.addEventListener("activate", function (e) {
        /* Drop every older cache. This is what makes a new runtime actually
           reach the device instead of sitting behind a stale copy. */
        e.waitUntil(
            caches.keys().then(function (names) {
                return Promise.all(names.map(function (n) {
                    if (n !== CACHE && n !== OUTBOX) { return caches.delete(n); }
                }));
            }).then(function () { return self.clients.claim(); })
        );
    });

    /*
    ** Cache first. Right here because the shell is versioned by the cache
    ** name: the files cannot change without the name changing, so there is
    ** nothing to go stale. Network-first would make every cold start wait
    ** for a timeout on a bad connection — the exact situation this is for.
    */
    self.addEventListener("fetch", function (e) {
        if (e.request.method !== "GET") { return; }
        e.respondWith(
            caches.match(e.request).then(function (hit) {
                if (hit) { return hit; }
                return fetch(e.request).catch(function () {
                    if (e.request.mode === "navigate") {
                        return caches.match("./index.html");
                    }
                    throw new Error("offline and not cached: " + e.request.url);
                });
            })
        );
    });

    /*
    ** Background Sync — the one thing a plain website cannot do at all.
    ** The app queued work and may since have been closed; the browser
    ** fires this when it next sees a connection.
    **
    ** This worker knows nothing about what the work means. It moves
    ** already-decided payloads that the app left in the handover store.
    ** The rules stayed in Ring.
    */
    self.addEventListener("sync", function (e) {
        if (e.tag === TAG && ENDPOINT) { e.waitUntil(flush()); }
    });

    function flush() {
        return caches.open(OUTBOX).then(function (c) {
            return c.match("pending").then(function (r) { return r ? r.json() : []; });
        }).then(function (items) {
            return Promise.all(items.map(function (item) {
                return fetch(ENDPOINT, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(item)
                }).then(function (r) {
                    if (!r.ok) { throw new Error("rejected"); }
                    return tell({ type: "pwa-sent", id: item.id });
                }).catch(function () {
                    /* left in the store; the next sync tries again */
                    return tell({ type: "pwa-failed", id: item.id });
                });
            }));
        });
    }

    function tell(msg) {
        return self.clients.matchAll({ includeUncontrolled: true }).then(function (cs) {
            cs.forEach(function (c) { c.postMessage(msg); });
        });
    }
}
