/*
** The service worker — the whole reason this sample exists.
**
** Three jobs:
**   1. install : put the shell, the Ring runtime and the rules in the cache
**   2. fetch   : answer from the cache first, so the app opens with no network
**   3. sync    : flush the outbox when the device gets a connection back,
**                EVEN IF the app is not open
**
** Job 3 is the one a plain website cannot do at all.
*/

/* Bump this when any cached file changes. The old cache is deleted on
   activate, which is what makes a new runtime actually reach the device
   instead of sitting behind a stale copy for a week. */
var CACHE = "stock-count-v1";

/* The runtime lives outside this folder. A service worker may cache any
   URL it can fetch — its scope limits which PAGES it controls, not which
   resources it may store. */
var RUNTIME = "../../playground/";

var SHELL = [
    "./",
    "./index.html",
    "./app.css",
    "./app.js",
    "./count.ring",
    "./expected.json",
    "./manifest.webmanifest",
    "./icon.svg",
    "./icon-maskable.svg",
    RUNTIME + "ringscript.js",
    RUNTIME + "ringscript.wasm"
];

self.addEventListener("install", function (e) {
    e.waitUntil(
        caches.open(CACHE).then(function (c) {
            /* addAll is atomic: one failure and nothing is cached, which is
               better than a half-installed app that opens to a blank page. */
            return c.addAll(SHELL);
        }).then(function () {
            /* Take over without waiting for every tab to close. */
            return self.skipWaiting();
        })
    );
});

self.addEventListener("activate", function (e) {
    e.waitUntil(
        caches.keys().then(function (names) {
            return Promise.all(names.map(function (n) {
                if (n !== CACHE) { return caches.delete(n); }
            }));
        }).then(function () { return self.clients.claim(); })
    );
});

/*
** Cache first for everything in the shell, network for everything else.
**
** Cache-first is right here because the shell is versioned by CACHE: the
** files never change without the cache name changing, so there is nothing
** to be stale about. The alternative — network-first with a cache
** fallback — would make every cold start wait for a timeout on a bad
** connection, which is exactly the situation this app is built for.
*/
self.addEventListener("fetch", function (e) {
    var req = e.request;
    if (req.method !== "GET") { return; }          /* posts go to the network */

    e.respondWith(
        caches.match(req).then(function (hit) {
            if (hit) { return hit; }
            return fetch(req).catch(function () {
                /* Offline and not cached. For a navigation, hand back the
                   app rather than the browser's dinosaur. */
                if (req.mode === "navigate") { return caches.match("./index.html"); }
                throw new Error("offline and not cached: " + req.url);
            });
        })
    );
});

/*
** Background Sync. The app queues a count, registers a sync, and may then
** be closed; the browser fires this when it next sees a connection.
**
** The worker deliberately does NOT know how to compute anything about a
** stock count. It moves an already-decided payload that the app left in
** the handover store. The rules stayed in Ring, where they belong.
*/
self.addEventListener("sync", function (e) {
    if (e.tag === "flush-counts") {
        e.waitUntil(flush());
    }
});

function flush() {
    return readPending().then(function (items) {
        return Promise.all(items.map(function (item) {
            return fetch("./api/counts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(item)
            }).then(function (r) {
                if (!r.ok) { throw new Error("rejected"); }
                return tell({ type: "sent", id: item.id });
            }).catch(function () {
                /* Left in the store. The next sync tries again. */
                return tell({ type: "failed", id: item.id });
            });
        }));
    });
}

/* The handover store. A service worker cannot read localStorage, so the
   app writes what needs sending into the Cache API, which both sides can
   reach. Small, and it avoids pulling in IndexedDB for four fields. */
function readPending() {
    return caches.open(CACHE + "-outbox").then(function (c) {
        return c.match("pending").then(function (r) {
            return r ? r.json() : [];
        });
    });
}

function tell(msg) {
    return self.clients.matchAll({ includeUncontrolled: true }).then(function (cs) {
        cs.forEach(function (c) { c.postMessage(msg); });
    });
}
