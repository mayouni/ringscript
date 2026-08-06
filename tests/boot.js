/*
** RingScript boot() tests — the path a page actually takes.
**
** boot() is the entry point the starter kit and every doc example use, and
** it is the only code that touches the network. Four defects lived here,
** all of them invisible to every other suite because no suite had a DOM:
**
**   · .ring files were fetched one at a time, each awaiting the last. Twelve
**     files took 2,160 ms against 251 ms for the same code inline — over
**     LOCALHOST, where a round trip is nearly free. On a real connection it
**     is a round trip per file.
**   · `ring` was published only after every file had downloaded AND run, so
**     a click during loading died with "ReferenceError: ring is not
**     defined" — and `onclick="ring.call('Greet')"` is the pattern the
**     starter kit teaches.
**   · A server answering a mistyped .ring path with HTML (a 404 page, or a
**     single-page-app fallback) produced "Error (C27) : Syntax Error" on
**     line 1, which tells the reader nothing at all.
**   · boot() read the document the moment it was called. It found the page's
**     Ring blocks only because awaiting the wasm happened to give the parser
**     time — a race a warm cache or a big document could lose, silently
**     running nothing.
**
** No browser here: a small fake document and fetch are enough, because what
** broke was the loader's own sequencing, not anything the DOM does.
**
** Usage: node tests/boot.js
*/
const fs = require("fs");
const path = require("path");

const WASM = path.join(__dirname, "..", "playground", "ringscript.wasm");
const LOADER = path.join(__dirname, "..", "playground", "ringscript.js");

let failures = 0;
function check(name, cond, detail) {
    console.log((cond ? "  PASS  " : "  FAIL  ") + name +
        (cond || detail === undefined ? "" : "  [" + detail + "]"));
    if (!cond) failures++;
}

/* ------------------------------------------------------- the fake document */

function fakeTag(spec) {
    return {
        type: "text/ring",
        textContent: spec.code || "",
        getAttribute: (n) => (n === "src" ? (spec.src || null) : null),
    };
}

/**
 * Install a document/fetch pair for one boot() run and return a handle.
 * `files` maps a path to { body } | { status } | { body, contentType }.
 * Every fetch takes `latency` ms, which is how parallelism becomes visible.
 */
function stage(tags, files, latency, readyState) {
    const log = { fetched: [], errors: [], warns: [], domReadyWaited: false };
    const listeners = [];
    global.document = {
        readyState: readyState || "complete",
        addEventListener(evt, fn) {
            if (evt === "DOMContentLoaded") { log.domReadyWaited = true; listeners.push(fn); }
        },
        querySelectorAll: () => tags.map(fakeTag),
        getElementById: () => null,
    };
    global.fetch = async (url) => {
        log.fetched.push({ url: url, at: Date.now() });
        if (latency) await new Promise((r) => setTimeout(r, latency));
        const f = files[url];
        if (!f) return { ok: false, status: 404, statusText: "Not Found", headers: { get: () => "" } };
        if (f.status) return { ok: false, status: f.status, statusText: "Error", headers: { get: () => "" } };
        return {
            ok: true, status: 200, statusText: "OK",
            headers: { get: (h) => (h.toLowerCase() === "content-type" ? (f.contentType || "text/plain") : "") },
            text: async () => f.body,
        };
    };
    log.fireDomReady = () => { global.document.readyState = "complete"; listeners.forEach((f) => f()); };
    return log;
}

/* --------------------------------------------------------------------- main */

(async () => {
    // The loader reads `ringscript.wasm` through fetch when given a string, so
    // hand boot() the bytes directly and let fetch serve only .ring files.
    const wasmBytes = fs.readFileSync(WASM);
    const wasmArg = wasmBytes.buffer.slice(wasmBytes.byteOffset,
        wasmBytes.byteOffset + wasmBytes.byteLength);

    delete require.cache[require.resolve(LOADER)];
    const RingScript = require(LOADER);

    const consoleError = console.error, consoleWarn = console.warn;
    const capture = (log) => {
        console.error = (...a) => log.errors.push(a.join(" "));
        console.warn = (...a) => log.warns.push(a.join(" "));
    };
    const release = () => { console.error = consoleError; console.warn = consoleWarn; };

    const bootOpts = () => ({ wasm: wasmArg, onOutput: () => {} });

    /* -------------------------------------------- 1. downloads run together */
    console.log("boot() — fetching");
    const N = 10, LAT = 40;
    const many = Array.from({ length: N }, (_, i) => ({ src: "/f" + i + ".ring" }));
    const manyFiles = {};
    for (let i = 0; i < N; i++) manyFiles["/f" + i + ".ring"] = { body: "func F" + i + "\n\treturn " + i };
    let log = stage(many, manyFiles, LAT);
    capture(log);
    const t0 = Date.now();
    const ring = await RingScript.boot(bootOpts());
    const elapsed = Date.now() - t0;
    release();
    // Serial would be N * LAT (400 ms). Parallel is about one LAT plus the
    // VM's own startup. The threshold sits well below serial and well above
    // parallel, so it distinguishes them without being timing-flaky.
    check(N + " files download in parallel, not one after another",
        elapsed < N * LAT * 0.6, elapsed + " ms (serial would be ~" + N * LAT + " ms)");
    check("every file arrived", log.fetched.length === N, String(log.fetched.length));
    check("and every file ran", ring.eval("? F0() + F5() + F9()").output.trim() === "14",
        ring.eval("? F0() + F5() + F9()").output.trim());

    /* --------------------------------------------- 2. running stays ordered */
    console.log("\nboot() — ordering");
    const ordered = [
        { src: "/a.ring" },
        { code: 'aOrder + "inline-1"' },
        { src: "/b.ring" },
        { code: 'aOrder + "inline-2"' },
    ];
    log = stage(ordered, {
        "/a.ring": { body: 'aOrder = []\naOrder + "file-a"' },
        "/b.ring": { body: 'aOrder + "file-b"' },
    }, 0);
    capture(log);
    const r2 = await RingScript.boot(bootOpts());
    release();
    const order = r2.eval("for x in aOrder ? x next").output.trim().split("\n");
    check("blocks run in document order despite parallel fetching",
        order.join(",") === "file-a,inline-1,file-b,inline-2", order.join(","));

    /* ------------------------------------------------ 3. failures in flight */
    console.log("\nboot() — a file that does not arrive");
    log = stage([
        { src: "/ok.ring" },
        { src: "/missing.ring" },
        { code: "nReachedTheEnd = 1" },
    ], { "/ok.ring": { body: "nFirstRan = 1" } }, 0);
    capture(log);
    const r3 = await RingScript.boot(bootOpts());
    release();
    check("a missing file does not stop the blocks after it",
        r3.eval("? nReachedTheEnd").output.trim() === "1");
    check("the missing file is named, with its status",
        log.errors.length === 1 && /missing\.ring/.test(log.errors[0]) && /404/.test(log.errors[0]),
        JSON.stringify(log.errors[0] || "").slice(0, 90));

    // A server that answers a wrong path with a page, not a 404.
    log = stage([{ src: "/typo.ring" }], {
        "/typo.ring": { body: "<!DOCTYPE html>\n<html><body>Not found</body></html>",
                        contentType: "text/html; charset=utf-8" },
    }, 0);
    capture(log);
    await RingScript.boot(bootOpts());
    release();
    check("HTML served for a .ring path says so, instead of a syntax error",
        log.errors.length === 1 && /returned HTML/.test(log.errors[0]),
        JSON.stringify(log.errors[0] || "").slice(0, 100));

    /* ----------------------------------------- 4. ring exists during startup */
    console.log("\nboot() — the window before it is ready");
    delete global.ring;
    log = stage([{ src: "/slow.ring" }], { "/slow.ring": { body: "func Greet p\n\treturn 1" } }, 60);
    capture(log);
    const booting = RingScript.boot(bootOpts());
    // Exactly what onclick="ring.call('Greet')" does while the page loads.
    const early = global.ring ? global.ring.call("Greet") : null;
    const threw = global.ring === undefined;
    await booting;
    release();
    check("ring is defined the instant boot() is called", !threw);
    check("an early call returns a result instead of throwing",
        early && early.ok === false && /still starting/.test(early.error),
        early ? String(early.error).slice(0, 70) : "ring was undefined");
    check("...and says so out loud, so a dead button is not silent",
        log.warns.some((w) => /still starting/.test(w)), JSON.stringify(log.warns[0] || ""));
    check("the real VM replaces it once ready",
        global.ring && !global.ring.booting && global.ring.eval("? 6*7").output.trim() === "42");

    /* ------------------------------------------------- 5. waits for the DOM */
    console.log("\nboot() — called from <head>, before the page is parsed");
    delete global.ring;
    log = stage([{ code: "nParsedLater = 5" }], {}, 0, "loading");
    capture(log);
    const early2 = RingScript.boot(bootOpts());
    // The parser finishes after boot() was called, as it does in a real page.
    setTimeout(() => log.fireDomReady(), 30);
    const r5 = await early2;
    release();
    check("boot() waits for DOMContentLoaded instead of racing the parser",
        log.domReadyWaited, "did not wait");
    check("blocks parsed after boot() started still run",
        r5.eval("? nParsedLater").output.trim() === "5",
        r5.eval("? nParsedLater").output.trim());

    /* ------------------------------------------------- 6. the runtime itself */
    console.log("\nboot() — when the runtime cannot load at all");
    delete global.ring;
    log = stage([], {}, 0);
    capture(log);
    let bootErr = null;
    try { await RingScript.boot({ wasm: "/no-such.wasm", onOutput: () => {} }); }
    catch (e) { bootErr = e; }
    const afterFail = global.ring ? global.ring.call("Anything") : null;
    release();
    check("a failed runtime load rejects rather than hanging", bootErr !== null,
        bootErr && bootErr.message.slice(0, 50));
    check("...and ring stops claiming it is 'still starting'",
        afterFail && /failed to load/.test(afterFail.error),
        afterFail ? String(afterFail.error).slice(0, 80) : "ring was undefined");

    console.log(failures ? "\n" + failures + " boot() check(s) FAILED." : "\nboot() clean.");
    process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("boot suite crashed:", e); process.exit(1); });
