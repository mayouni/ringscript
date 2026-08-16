/*
** The service worker.
**
** Almost all of it is the library's: cache-first so the app opens with no
** network, an activate that drops older caches so a new runtime actually
** reaches the device, and the Background Sync handler that flushes the
** outbox when a connection returns even if the app is closed.
**
** What stays here is the only part the library cannot know: which files
** belong to this application.
*/

importScripts("lib/pwa/sw-pwa.js");

PwaServiceWorker({
    /* Bump this when any cached file changes. */
    cache: "stock-count-v3",

    shell: [
        "./",
        "./index.html",
        "./app.css",
        "./app.js",
        "./count.ring",
        "./expected.json",
        "./manifest.webmanifest",
        "./icon.svg",
        "./icon-maskable.svg",

        /* the library */
        "lib/pwa/pwa.js",
        "lib/pwa/pwa.ring",

        /* the runtime. It lives outside this folder, and that is fine: a
           service worker's scope limits which PAGES it controls, not which
           resources it may store. */
        "../../playground/ringscript.js",
        "../../playground/ringscript.wasm"
    ],

    endpoint: "./api/counts"
});
