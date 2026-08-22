/*
** The service worker: entirely the library's, minus the one thing it
** cannot know -- which files belong to this application.
*/
importScripts("lib/pwa/sw-pwa.js");

PwaServiceWorker({
    cache: "cafe-tickets-v1",
    shell: [
        "./", "./index.html", "./app.js", "./tickets.ring",
        "./manifest.webmanifest",
        "lib/pwa/pwa.js", "lib/pwa/pwa.ring",
        "../../playground/ringscript.js",
        "../../playground/ringscript.wasm"
    ]
});
