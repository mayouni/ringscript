/*
** RingScript PWA — the browser half, v2.
**
** One global, one entry point:
**
**     <script src="lib/pwa/pwa.js"></script>
**     const pwa = await Pwa.attach(ring, { world: "cousbox-remote",
**                                          device: "phone-7",
**                                          endpoint: "/api/orders" });
**
** Everything here is wiring — storage, service worker, connection, the
** degraded-mode rung, the stream. The queue's RULES live in ring/pwa.ring,
** and the rung is pushed into Ring too, because a refusal like "card
** payment needs the server" is a business rule and business rules live in
** the Ring half (PARTITION-FOUNDATIONS.md §2.3).
**
** v2 exists because the design document found v1's three defects by
** reading it: flush() raced sends through Promise.all so replay was
** unordered; save() swallowed quota errors so a full store accepted an
** order it never persisted; and the default storage key was
** location.pathname inside localStorage — origin-bound, the 15 August
** trap carried as a default. Each has its fix marked below.
*/

(function (global) {
    "use strict";

    /* Where this library's own files sit. Derived from this script's src so
       the page can put it anywhere without configuring a path. */
    function ownBase() {
        var s = (typeof document !== "undefined") && document.currentScript;
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

    /* A path is same-origin when it is relative, or absolute on this page's
       own origin. Anything else is refused at attach: a cross-origin
       endpoint is how a world's traffic earns the OS a reason to route away
       from the LAN, and the field already proved same-origin keeps the
       "use cellular?" wrong answer benign (PARTITION-FOUNDATIONS.md §4). */
    function assertSameOrigin(url, what) {
        if (!url) { return; }
        if (typeof location === "undefined") { return; }   /* Node harness */
        if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.slice(0, 2) === "//") {
            if (url.indexOf(location.origin + "/") !== 0) {
                throw new Error("pwa: " + what + " must be same-origin — got " + url);
            }
        }
    }

    /* ================================================================ */
    /* Storage drivers.                                                  */
    /*                                                                   */
    /* One record per world: { snapshot, pending, endpoint }. snapshot   */
    /* is the Ring half's whole state; pending is the ready-to-send      */
    /* payload list the service worker replays when the app is closed —  */
    /* written in the same save, so the worker and the app can never     */
    /* disagree about what is owed. The default is IndexedDB: the worker */
    /* can read it directly (v1 round-tripped through the Cache API      */
    /* because a worker cannot read localStorage), and the quota is not  */
    /* 5 MB. localStorage stays available for tiny worlds; either way    */
    /* the store is ORIGIN-BOUND and the doctrine of §1 R3 applies: it   */
    /* may hold only replaceable caches and the outbox.                  */
    /* ================================================================ */

    var DB_NAME = "ringscript-pwa", DB_STORE = "worlds";

    function idbOpen() {
        return new Promise(function (resolve, reject) {
            var req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = function () { req.result.createObjectStore(DB_STORE); };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
        });
    }

    var drivers = {
        indexeddb: function (world) {
            return {
                name: "indexeddb",
                load: function () {
                    return idbOpen().then(function (db) {
                        return new Promise(function (resolve, reject) {
                            var tx = db.transaction(DB_STORE, "readonly");
                            var req = tx.objectStore(DB_STORE).get(world);
                            req.onsuccess = function () { resolve(req.result || null); };
                            req.onerror = function () { reject(req.error); };
                        });
                    });
                },
                save: function (record) {
                    return idbOpen().then(function (db) {
                        return new Promise(function (resolve, reject) {
                            var tx = db.transaction(DB_STORE, "readwrite");
                            tx.objectStore(DB_STORE).put(record, world);
                            tx.oncomplete = function () { resolve(); };
                            tx.onerror = function () { reject(tx.error); };
                            tx.onabort = function () { reject(tx.error || new Error("aborted")); };
                        });
                    });
                }
            };
        },
        local: function (world) {
            var key = "ringscript.pwa/" + world;
            return {
                name: "local",
                load: function () {
                    try {
                        var s = localStorage.getItem(key);
                        return Promise.resolve(s ? JSON.parse(s) : null);
                    } catch (e) { return Promise.reject(e); }
                },
                save: function (record) {
                    try {
                        localStorage.setItem(key, JSON.stringify(record));
                        return Promise.resolve();
                    } catch (e) { return Promise.reject(e); }   /* quota: LOUD */
                }
            };
        },
        memory: function () {
            var held = null;
            return {
                name: "memory",
                load: function () { return Promise.resolve(held); },
                save: function (record) { held = record; return Promise.resolve(); }
            };
        }
    };

    global.Pwa = {
        version: "2.0.0",
        drivers: drivers,

        /*
        ** ring              a loaded RingScript VM
        ** opts.world        REQUIRED — the storage identity (§1 R2). Storage is
        **                   keyed by this name, never by where the page happens
        **                   to be served from.
        ** opts.device       something stable for this device or user
        ** opts.endpoint     same-origin path; when set, flush() sends ONE ordered
        **                   batch the server answers per entry
        ** opts.send         (payload) => Promise — per-entry sender, the
        **                   pre-batch path; ordered, stop-at-first-failure
        ** opts.stream       { url, apply, reconcile, snapshotEvent, heartbeatEvent,
        **                     events } — §3's snapshot/stream contract
        ** opts.silence      seconds of true silence before the alarm (default 8,
        **                   the field-tuned value — Law 4)
        ** opts.mirror       true — offer the origin-free file mirror (§1 R4)
        ** opts.sw           path to the app's service worker, or null to skip
        ** opts.syncTag      Background Sync tag, must match the worker's
        ** opts.onChange     called whenever the queue or the connection changes
        **
        ** Injectable for tests and unusual hosts (the §5 harness exists
        ** because these exist): opts.storage (a driver), opts.now, opts.timer
        ** ({set, clear}), opts.fetchFn, opts.eventSource, opts.ringSource.
        */
        attach: async function (ring, opts) {
            opts = opts || {};
            if (!opts.world || typeof opts.world !== "string") {
                throw new Error("pwa: attach needs opts.world — the storage identity. " +
                    "Storage is keyed by the world's name, never by its serving path.");
            }
            var world = opts.world;
            var now = opts.now || function () { return Date.now(); };
            var timer = opts.timer || { set: function (f, ms) { return setTimeout(f, ms); },
                                        clear: function (id) { clearTimeout(id); } };
            var fetchFn = opts.fetchFn || (typeof fetch !== "undefined" ? fetch.bind(global) : null);
            var silence = (opts.silence || 8) * 1000;
            var syncTag = opts.syncTag || "pwa-flush";
            var onChange = opts.onChange || function () {};
            var endpoint = opts.endpoint || null;
            var stream = opts.stream || null;
            var send = opts.send || null;

            assertSameOrigin(endpoint, "endpoint");
            if (stream) { assertSameOrigin(stream.url, "stream.url"); }

            var storage = opts.storage ||
                (typeof indexedDB !== "undefined" ? drivers.indexeddb(world)
                                                  : drivers.memory());

            /* 1. the Ring half, loaded by the library rather than the page */
            var src = opts.ringSource;
            if (!src) { src = await (await fetchFn(BASE + "pwa.ring")).text(); }
            var ev = ring.eval(src);
            if (!ev.ok) { throw new Error("pwa: pwa.ring failed: " + ev.error); }

            var ask = function (fn, arg) {
                return parse(ring.call(fn, arg === undefined ? 1 : arg), fn);
            };

            ask("PwaOutboxDevice", opts.device || "device");

            /* ---------------------------------------------------- events */
            var listeners = {};
            function on(name, fn) {
                (listeners[name] = listeners[name] || []).push(fn);
                return api;
            }
            function emit(name, arg) {
                (listeners[name] || []).forEach(function (fn) {
                    try { fn(arg); } catch (e) { /* a listener must not stop the runtime */ }
                });
            }

            /* ------------------------------------------------------ rung */
            /* alone -> streaming -> unreachable -> streaming (§4). Pushed
               into Ring on every transition so world RULES can refuse by
               rung. navigator.onLine is never consulted here: it reports
               link association, not server reachability. */
            var rung = "alone";
            var silenceTimer = null;

            function setRung(next) {
                if (next === rung) { return; }
                rung = next;
                ring.call("PwaRungSet", next);
                emit("rung", next);
                onChange(api);
            }
            function noteAlive() {
                if (silenceTimer) { timer.clear(silenceTimer); silenceTimer = null; }
                if (rung !== "streaming") {
                    if (rung === "unreachable") { emit("alive"); }
                    setRung("streaming");
                }
            }
            function noteSilence() {
                /* the alarm arms once; a blip shorter than `silence` clears
                   it in noteAlive and no event ever fires (Law 4) */
                if (silenceTimer || rung === "unreachable") { return; }
                silenceTimer = timer.set(function () {
                    silenceTimer = null;
                    setRung("unreachable");
                    emit("silent");
                }, silence);
            }

            /* --------------------------------------------------- storage */
            var storageFull = false;
            var mirrorHandle = null;

            function record() {
                var pending = ask("PwaOutboxList", 0)
                    .filter(function (e) { return e.state === "queued"; })
                    .map(function (e) { return ask("PwaOutboxPayload", e.id); });
                return {
                    snapshot: ring.call("PwaOutboxSnapshot", 0).result,
                    pending: pending,        /* the worker's copy, same write */
                    endpoint: endpoint,
                    world: world,
                    saved: now()
                };
            }

            function save() {
                var rec = record();
                var p = storage.save(rec).then(function () {
                    storageFull = false;
                    return true;
                }, function () {
                    storageFull = true;
                    emit("banner", api.states());
                    return false;
                });
                if (mirrorHandle) {
                    p = p.then(function (okv) {
                        return writeMirror(rec).then(function () { return okv; },
                                                     function () { return okv; });
                    });
                }
                return p;
            }

            function writeMirror(rec) {
                return mirrorHandle.createWritable().then(function (w) {
                    return w.write(JSON.stringify(rec)).then(function () { return w.close(); });
                });
            }

            /* 2. anything left over from last time — new store first, then
               a one-time import of a v1 localStorage queue so an upgrade
               does not strand work that was queued under 1.x */
            var stored = await storage.load().catch(function () { return null; });
            if (stored && stored.snapshot) {
                ring.call("PwaOutboxRestore", stored.snapshot);
            } else if (typeof localStorage !== "undefined" && typeof location !== "undefined") {
                try {
                    var v1key = opts.storageKey || ("ringscript.pwa." + location.pathname);
                    var v1 = localStorage.getItem(v1key);
                    if (v1) { ring.call("PwaOutboxRestore", v1); await save(); }
                } catch (e) { /* private mode; nothing to import */ }
            }

            /* ---------------------------------------------------- the api */
            var inFlight = null;

            var api = {
                world: world,
                on: on,

                identity: {
                    world: world,
                    origin: (typeof location !== "undefined") ? location.origin : null,
                    pinned_to_ip: (typeof location !== "undefined") &&
                        (/^\d{1,3}(\.\d{1,3}){3}$/.test(location.hostname) ||
                         location.hostname.indexOf(":") >= 0),
                    persisted: null,
                    storage: storage.name || "custom"
                },

                rung: function () { return rung; },

                /* The named banner states, most severe first (§4). A world
                   renders banner() and is honest by construction. */
                states: function () {
                    var s = [];
                    if (storageFull) { s.push("STORAGE-FULL"); }
                    if (rung === "unreachable") { s.push("NETWORK-LOST"); }
                    if (rung === "alone") { s.push("ALONE"); }
                    if (api.identity.pinned_to_ip) { s.push("STORAGE-PINNED-TO-ADDRESS"); }
                    return s;
                },
                banner: function () { return api.states()[0] || null; },

                /* Queue work, DURABLY, before anything is sent — and before
                   ok is returned. v1 could answer ok for an entry a full
                   store had already dropped; v2 rolls the add back and says
                   so (§2.3: memory-only durability is a lie with a
                   countdown). The id is made in Ring, before any send, so a
                   retry cannot become a second order. */
                queue: function (kind, payload) {
                    var r = ask("PwaOutboxAdd", JSON.stringify(
                        [["kind", kind], ["payload", payload], ["now", now()]]));
                    if (!r.ok) { return Promise.resolve(r); }
                    return save().then(function (savedOk) {
                        if (!savedOk) {
                            ask("PwaOutboxDrop", r.id);
                            return { ok: 0, problem: "storage-full",
                                     pending: ask("PwaOutboxPending", 0) };
                        }
                        onChange(api);
                        api.requestSync();
                        return r;
                    });
                },

                /* Replay: ordered, at-least-once, idempotent by entry id.
                   Concurrent callers share one flush — two overlapping
                   flushes are how v1.0 sent the same entry twice. */
                flush: function () {
                    if (inFlight) { return inFlight; }
                    inFlight = (endpoint ? api.flushBatchOnce() : api.flushOnce());
                    var clear = function () { inFlight = null; };
                    inFlight.then(clear, clear);
                    return inFlight;
                },

                /* Per-entry, STRICTLY IN SEQ ORDER, one request in flight,
                   and it STOPS at the first failure — sending entry 3 after
                   entry 2 failed would let 3 arrive before 2's retry, which
                   is the reordering the contract forbids. (v1 raced all
                   entries through Promise.all; that is defect one.) */
                flushOnce: async function () {
                    if (!send) { return []; }
                    var results = [];
                    var pending = ask("PwaOutboxList", 0)
                        .filter(function (e) { return e.state === "queued"; });
                    for (var i = 0; i < pending.length; i++) {
                        var e = pending[i];
                        var p = ask("PwaOutboxPayload", e.id);
                        try {
                            await send(p);
                            ask("PwaOutboxSent", e.id);
                            results.push({ id: e.id, sent: true });
                            noteAlive();
                        } catch (err) {
                            ask("PwaOutboxRollback", e.id);
                            results.push({ id: e.id, sent: false });
                            noteSilence();
                            break;
                        }
                    }
                    await save(); onChange(api);
                    return results;
                },

                /* One ordered batch, the server answers per entry — fewer
                   round trips on a bad link, same guarantee: a refused
                   entry is marked refused, a failed REQUEST rolls the whole
                   batch back (nothing was received; nothing was sent). */
                flushBatchOnce: async function () {
                    var batch = ask("PwaOutboxBatch", 0);
                    if (batch.count === 0) { return null; }
                    ask("PwaOutboxMarkSending", 0);
                    try {
                        var res = await fetchFn(endpoint, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(batch)
                        });
                        if (!res.ok) { throw new Error("HTTP " + res.status); }
                        var answer = await res.json();
                        var summary = ask("PwaOutboxApply", JSON.stringify(answer));
                        noteAlive();
                        await save(); onChange(api);
                        return summary;
                    } catch (err) {
                        ask("PwaOutboxRollbackAll", 0);
                        noteSilence();
                        await save(); onChange(api);
                        throw err;
                    }
                },

                pending: function () { return ask("PwaOutboxPending", 0); },
                oldest: function () { return ask("PwaOutboxOldest", now()); },
                list: function () { return ask("PwaOutboxList", 0); },
                forget: function () {
                    var n = ask("PwaOutboxForget", 0);
                    save(); onChange(api);
                    return n;
                },

                /* A retry HINT only — never a rung input. */
                online: function () {
                    return (typeof navigator !== "undefined") ? navigator.onLine : true;
                },

                requestSync: function () {
                    if (!api.registration || !("sync" in api.registration)) { return Promise.resolve(false); }
                    return api.registration.sync.register(syncTag)
                        .then(function () { return true; })
                        .catch(function () { return false; });
                },

                /* The origin-free escape (§1 R4): a user-visible file that
                   mirrors the queue on every save. A file has no origin, so
                   it survives the DHCP lease that origin storage does not.
                   enable() must be called from a user gesture. */
                mirror: {
                    active: false,
                    enable: function () {
                        if (typeof global.showSaveFilePicker !== "function") {
                            return Promise.resolve(false);
                        }
                        return global.showSaveFilePicker({
                            suggestedName: world + "-journal.json",
                            types: [{ description: "RingScript journal",
                                      accept: { "application/json": [".json"] } }]
                        }).then(function (h) {
                            mirrorHandle = h;
                            api.mirror.active = true;
                            return save().then(function () { return true; });
                        }).catch(function () { return false; });
                    },
                    download: function () {
                        if (typeof document === "undefined") { return false; }
                        var blob = new Blob([JSON.stringify(record())],
                                            { type: "application/json" });
                        var a = document.createElement("a");
                        a.href = URL.createObjectURL(blob);
                        a.download = world + "-journal.json";
                        a.click();
                        URL.revokeObjectURL(a.href);
                        return true;
                    }
                },

                install: { available: false, prompt: function () { return Promise.resolve(false); } },
                registration: null
            };

            /* 3. persistence: ask, and SURFACE the answer — an ungranted
               persist means the bucket is evictable under pressure */
            if (typeof navigator !== "undefined" && navigator.storage && navigator.storage.persist) {
                navigator.storage.persist().then(function (granted) {
                    api.identity.persisted = granted;
                    onChange(api);
                }).catch(function () {});
            }

            /* 4. the stream (§3). The event order after a reconnection is
               part of the contract and a world may rely on it:
               connected -> snapshot -> orphaned xN -> replay -> live. */
            if (stream) {
                var ES = opts.eventSource || global.EventSource;
                var snapEvent = stream.snapshotEvent || "snapshot";
                var beatEvent = stream.heartbeatEvent || "heartbeat";
                var es = new ES(stream.url);

                es.addEventListener("open", function () { emit("connected"); });

                es.addEventListener(snapEvent, function (e) {
                    /* Law 2, enforced by construction on the library's side:
                       one whole snapshot, never two concurrently, and the
                       world's apply contract is clear-then-load. */
                    var r = ring.call(stream.apply, e.data);
                    if (!r.ok) { emit("error", "apply: " + r.error); return; }
                    emit("snapshot");
                    if (stream.reconcile) {
                        var orphans = parse(ring.call(stream.reconcile, 1), stream.reconcile);
                        if (Object.prototype.toString.call(orphans) === "[object Array]") {
                            orphans.forEach(function (ghost) {
                                /* drop queued transitions on the dead id */
                                ask("PwaOutboxList", 0)
                                    .filter(function (en) { return en.state === "queued"; })
                                    .forEach(function (en) {
                                        var p = ask("PwaOutboxPayload", en.id);
                                        if (p.payload && p.payload.id === ghost) {
                                            ask("PwaOutboxDrop", en.id);
                                        }
                                    });
                                emit("orphaned", ghost);
                            });
                        }
                    }
                    noteAlive();
                    emit("replay");
                    api.flush().then(function () { emit("live"); },
                                     function () { emit("live"); });
                });

                var alive = function () { noteAlive(); };
                es.addEventListener(beatEvent, alive);
                es.addEventListener("message", function (e) { noteAlive(); emit("event", e); });
                (stream.events || []).forEach(function (name) {
                    es.addEventListener(name, function (e) {
                        noteAlive();
                        emit("event", { type: name, data: e.data });
                    });
                });
                es.addEventListener("error", function () { noteSilence(); });
                api.stream = es;
            }

            /* 5. the service worker: installability and offline. With the
               IndexedDB driver the worker reads the outbox record itself —
               v1's Cache API handover is gone. */
            if (opts.sw && typeof navigator !== "undefined" && "serviceWorker" in navigator) {
                try {
                    api.registration = await navigator.serviceWorker.register(opts.sw);
                } catch (e) {
                    api.swError = e.message;   /* needs https or localhost */
                }
                navigator.serviceWorker.addEventListener("message", function (e) {
                    if (!e.data) { return; }
                    if (e.data.type === "pwa-sent") { ask("PwaOutboxSent", e.data.id); }
                    if (e.data.type === "pwa-failed") { ask("PwaOutboxRollback", e.data.id); }
                    save(); onChange(api);
                });
            }

            /* 6. the install prompt */
            if (typeof global.addEventListener === "function") {
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

                /* 7. the connection — a retry hint, never a rung input */
                global.addEventListener("online", function () { onChange(api); api.flush(); });
                global.addEventListener("offline", function () { onChange(api); });
            }

            onChange(api);
            return api;
        }
    };
})(typeof window !== "undefined" ? window : globalThis);
