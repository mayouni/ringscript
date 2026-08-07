/*
** RingScript vs. its peers — three interpreters, one measurement discipline.
**
** Every number RingScript publishes is absolute: 6.6 ms startup, 30 MB/s
** JSON. This harness gives those numbers CONTEXT by running the same
** scenarios through two other C interpreters compiled to wasm:
**
**   Lua 5.4  (wasmoon)            271 KB — the closest architectural twin
**   QuickJS  (quickjs-emscripten) 519 KB — the strongest small interpreter
**
** Two honesty rules, or this is marketing:
**   · Each language gets idiomatic code — the same ALGORITHM, written the
**     way that language's programmer would write it, not a transliteration.
**   · Losses are published with the wins. The point is to learn where the
**     headroom is, not to win.
**
** Known asymmetries, stated up front rather than discovered in a footnote:
**   · QuickJS's JSON is native C, and since HEADROOM_PLAN P2 Ring's is
**     too (held byte-identical to the pure ringlib/json.ring reference);
**     Lua's json.lua stays pure. The row measures what a C codec buys.
**   · Lua's string ops (gsub, table.concat) are C under the hood too —
**     stdlib primitives are part of what is being compared.
**   · wasmoon reports errors by THROWING a JavaScript exception; that is
**     its documented contract, not a defect. The robustness question is
**     whether the instance survives and the host can tell what happened —
**     not which reporting style the API chose.
**
** Setup:  cd tests/rivals && npm install     (wasmoon, quickjs-emscripten)
** Usage:  node run.js [--quick] [--json=results.json]
*/
"use strict";
const fs = require("fs");
const path = require("path");

const QUICK = process.argv.includes("--quick");
const JSON_OUT = (process.argv.find((a) => a.startsWith("--json=")) || "").slice(7);

const ms = (ns) => Number(ns) / 1e6;
function stats(samples) {
    const s = samples.slice().sort((a, b) => a - b);
    return { min: s[0], median: s[Math.floor(s.length / 2)], n: s.length };
}
async function measure(fn, minReps, minMs) {
    if (QUICK) { minReps = Math.max(2, Math.round(minReps / 5)); minMs = minMs / 5; }
    for (let i = 0; i < 3; i++) await fn();
    const samples = [];
    const t0 = process.hrtime.bigint();
    while (samples.length < minReps || ms(process.hrtime.bigint() - t0) < minMs) {
        const a = process.hrtime.bigint();
        await fn();
        samples.push(ms(process.hrtime.bigint() - a));
    }
    return stats(samples);
}

/* ------------------------------------------------------------- adapters */
/*
** Uniform surface over three very different APIs:
**   fresh()    -> handle   a new isolated evaluator (module already compiled)
**   handle.run(code)       -> { ok, error? }  — never throws out of the adapter;
**                             how the engine SIGNALED the error is recorded
**   handle.get(expr)       -> string          — for correctness probes
**   handle.heapBytes()     -> number
**   handle.dispose()
** run() includes whatever marshalling the engine's API requires — that IS
** the round trip a page pays.
*/

async function ringAdapter() {
    const RingScript = require(path.join(__dirname, "..", "..", "playground", "ringscript.js"));
    const buf = fs.readFileSync(path.join(__dirname, "..", "..", "playground", "ringscript.wasm"));
    const shared = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const bytes = () => shared;
    return {
        name: "Ring 1.27 (RingScript)",
        lang: "ring",
        wasmBytes: buf.length,
        freshNote: "module compiled once, cached by the loader (HEADROOM_PLAN P1)",
        async fresh() {
            const vm = await RingScript.load(bytes(), { onOutput: () => {} });
            return {
                run(code) { const r = vm.eval(code); return r.ok ? { ok: true } : { ok: false, error: r.error }; },
                get(expr) { const r = vm.eval("? " + expr); return r.ok ? r.output.trim() : "ERR " + r.error; },
                heapBytes() { return vm.instance.exports.memory.buffer.byteLength; },
                dispose() {},
            };
        },
    };
}

async function luaAdapter() {
    const { LuaFactory } = require("wasmoon");
    const factory = new LuaFactory();          // compiles the module once
    const module = await factory.getLuaModule();
    const jsonSrc = fs.readFileSync(path.join(__dirname, "vendor", "json.lua"), "utf8");
    return {
        name: "Lua 5.4 (wasmoon)",
        lang: "lua",
        wasmBytes: fs.statSync(path.join(__dirname, "node_modules", "wasmoon", "dist", "glue.wasm")).size,
        freshNote: "module compiled once per factory; engines share it",
        jsonSetup: "json = (function()\n" + jsonSrc + "\nend)()",
        async fresh() {
            const lua = await factory.createEngine();
            return {
                run(code) {
                    // Errors THROW here by contract; the adapter's job is to
                    // report, the harness's job is to judge survival.
                    try { lua.doStringSync(code); return { ok: true }; }
                    catch (e) { return { ok: false, error: String(e && e.message || e), threw: true }; }
                },
                get(expr) {
                    try { lua.doStringSync("__probe = " + expr); return String(lua.global.get("__probe")); }
                    catch (e) { return "ERR " + (e && e.message); }
                },
                heapBytes() { return module.module.HEAPU8.length; },
                dispose() { try { lua.global.close(); } catch (e) {} },
            };
        },
    };
}

async function quickjsAdapter() {
    const { getQuickJS } = require("quickjs-emscripten");   // release-sync build
    const QuickJS = await getQuickJS();                     // compiles once
    return {
        name: "QuickJS (quickjs-emscripten)",
        lang: "js",
        wasmBytes: fs.statSync(path.join(__dirname, "node_modules", "@jitl",
            "quickjs-wasmfile-release-sync", "dist", "emscripten-module.wasm")).size,
        freshNote: "module compiled once; contexts share it",
        async fresh() {
            const ctx = QuickJS.newContext();
            return {
                run(code) {
                    let r;
                    try { r = ctx.evalCode(code); }
                    catch (e) { return { ok: false, error: String(e && e.message || e), threw: true }; }
                    if (r.error) {
                        let msg = "";
                        try { const d = ctx.dump(r.error); msg = (d && (d.name + ": " + d.message)) || String(d); } catch (e) {}
                        r.error.dispose();
                        return { ok: false, error: msg };
                    }
                    r.value.dispose();
                    return { ok: true };
                },
                get(expr) {
                    const r = ctx.evalCode(expr);
                    if (r.error) { const d = ctx.dump(r.error); r.error.dispose(); return "ERR " + JSON.stringify(d); }
                    const v = ctx.dump(r.value); r.value.dispose(); return String(v);
                },
                heapBytes() {
                    const mu = ctx.runtime.computeMemoryUsage();
                    const d = ctx.dump(mu); mu.dispose();
                    return d.memory_used_size;   // the context's own accounting
                },
                dispose() { ctx.dispose(); },
            };
        },
    };
}

/* ------------------------------------------------------------ scenarios */
/*
** Same algorithm per row; idiomatic expression per language. `setup` runs
** once on a fresh evaluator, `body` is what gets timed, `probe`/`expect`
** verify the work actually happened before any timing is believed.
*/
const REC = 200;   // records in the JSON payload, as in tests/bench.js

const SCENARIOS = [
    {
        id: "eval-min", label: "assign a global", reps: 300, minMs: 300,
        ring: { body: "x = 1 + 1", probe: "x", expect: "2" },
        lua:  { body: "x = 1 + 1", probe: "x", expect: "2" },
        js:   { body: "x = 1 + 1;", probe: "x", expect: "2" },
    },
    {
        id: "loop-10k", label: "10,000-iteration loop", reps: 120, minMs: 300,
        ring: { body: "x = 0\nfor i = 1 to 10000 x = i next", probe: "x", expect: "10000" },
        lua:  { body: "x = 0 for i = 1, 10000 do x = i end", probe: "x", expect: "10000" },
        js:   { body: "x = 0; for (let i = 1; i <= 10000; i++) x = i;", probe: "x", expect: "10000" },
    },
    {
        id: "string-2k", label: "build a 2,000-char string", reps: 120, minMs: 300,
        ring: { body: 'c = ""\nfor i = 1 to 2000 c += "x" next', probe: "len(c)", expect: "2000" },
        lua:  { body: 'c = "" for i = 1, 2000 do c = c .. "x" end', probe: "#c", expect: "2000" },
        js:   { body: 'c = ""; for (let i = 1; i <= 2000; i++) c += "x";', probe: "c.length", expect: "2000" },
    },
    {
        // Copy then sort, all three: Ring's sort() copies, Lua's table.sort
        // is in-place (so the copy keeps the input unsorted, same work every
        // rep), JS sorts a slice with a numeric comparator.
        id: "sort-2k", label: "copy + sort 2,000 numbers", reps: 60, minMs: 300,
        ring: {
            setup: "aRnd = []\ns = 12345\nfor i = 1 to 2000\n  s = (s * 1103515245 + 12345) % 2147483648\n  aRnd + s\nnext",
            body: "aSorted = sort(aRnd)", probe: "len(aSorted)", expect: "2000",
        },
        lua: {
            setup: "arr = {} local s = 12345 for i = 1, 2000 do s = (s * 1103515245 + 12345) % 2147483648 arr[i] = s end",
            body: "local c = {} for i = 1, #arr do c[i] = arr[i] end table.sort(c) sorted = c",
            probe: "#sorted", expect: "2000",
        },
        js: {
            setup: "arr = []; { let s = 12345; for (let i = 0; i < 2000; i++) { s = (s * 1103515245 + 12345) % 2147483648; arr.push(s); } }",
            body: "sorted = arr.slice().sort((a, b) => a - b);", probe: "sorted.length", expect: "2000",
        },
    },
    {
        id: "objects-2k", label: "create 2,000 objects", reps: 60, minMs: 300,
        ring: { setup: "class BenchPoint\n  bpx bpy bpz", body: "for i = 1 to 2000 oPt = new BenchPoint next" },
        lua:  { body: "for i = 1, 2000 do local o = { bpx = 0, bpy = 0, bpz = 0 } end" },
        js:   { setup: "class BenchPoint { constructor() { this.bpx = 0; this.bpy = 0; this.bpz = 0; } } globalThis.BP = BenchPoint;",
                body: "for (let i = 1; i <= 2000; i++) { const o = new BP(); }" },
    },
    {
        id: "json-encode", label: "JSON encode ~8.7 KB", reps: 25, minMs: 300, jsonNote: true,
        ring: {
            setup: "aBench = []\nfor i = 1 to " + REC + "\n" +
                   '  aBench + [ ["id", i], ["name", "member " + i], ["amount", i * 1.5] ]\nnext\n' +
                   "cJ = JsonEncode(aBench)",
            body: "cJ = JsonEncode(aBench)", probe: "len(cJ) > 5000", expect: "1",
        },
        lua: {
            setupFromAdapter: "jsonSetup",
            setup2: "aBench = {} for i = 1, " + REC + ' do aBench[i] = { id = i, name = "member " .. i, amount = i * 1.5 } end cJ = json.encode(aBench)',
            body: "cJ = json.encode(aBench)", probe: "#cJ > 5000", expect: "true",
        },
        js: {
            setup: 'aBench = []; for (let i = 1; i <= ' + REC + '; i++) aBench.push({ id: i, name: "member " + i, amount: i * 1.5 }); cJ = JSON.stringify(aBench);',
            body: "cJ = JSON.stringify(aBench);", probe: "cJ.length > 5000", expect: "true",
        },
    },
    {
        id: "json-decode", label: "JSON decode ~8.7 KB", reps: 25, minMs: 300, jsonNote: true,
        ring: { setup: "aBench = []\nfor i = 1 to " + REC + "\n" +
                       '  aBench + [ ["id", i], ["name", "member " + i], ["amount", i * 1.5] ]\nnext\n' +
                       "cJ = JsonEncode(aBench)",
                body: "aBack = JsonDecode(cJ)", probe: "len(aBack)", expect: String(REC) },
        lua:  { setupFromAdapter: "jsonSetup",
                setup2: "aBench = {} for i = 1, " + REC + ' do aBench[i] = { id = i, name = "member " .. i, amount = i * 1.5 } end cJ = json.encode(aBench)',
                body: "aBack = json.decode(cJ)", probe: "#aBack", expect: String(REC) },
        js:   { setup: 'aBench = []; for (let i = 1; i <= ' + REC + '; i++) aBench.push({ id: i, name: "member " + i, amount: i * 1.5 }); cJ = JSON.stringify(aBench);',
                body: "aBack = JSON.parse(cJ);", probe: "aBack.length", expect: String(REC) },
    },
    {
        // The DoS shape from the JSON hardening: one megabyte through the
        // codec. Ring took 260 s here before the sliding-window rewrite.
        id: "json-1mb", label: "1 MB string: encode + decode", reps: 3, minMs: 200, jsonNote: true,
        ring: { setup: 'cBig = "a"\nwhile len(cBig) < 1048576\n  cBig += cBig\nend\naOne = [cBig]',
                body: "cJ1 = JsonEncode(aOne)\naB1 = JsonDecode(cJ1)", probe: "len(aB1[1])", expect: "1048576" },
        lua:  { setupFromAdapter: "jsonSetup",
                setup2: 'cBig = "a" while #cBig < 1048576 do cBig = cBig .. cBig end aOne = { cBig }',
                body: "cJ1 = json.encode(aOne) aB1 = json.decode(cJ1)", probe: "#aB1[1]", expect: "1048576" },
        js:   { setup: 'cBig = "a".repeat(1048576); aOne = [cBig];',
                body: "cJ1 = JSON.stringify(aOne); aB1 = JSON.parse(cJ1);", probe: "aB1[0].length", expect: "1048576" },
    },
];

/* ------------------------------------------------- endurance + hostility */

const SOAK = {
    ring: [
        "nSoak = %I + 1",
        'cSoak = "row " + %I + " of many"',
        "aSoak = [1,2,3]  add(aSoak, %I)  aSoak = sort(aSoak)",
        "NoSuchFunction%I()",
        "if %I % 2 = 0  x = 1  else  x = 2  ok",
        "$$ not ring $$",
    ],
    lua: [
        "nSoak = %I + 1",
        'cSoak = "row " .. %I .. " of many"',
        "local a = { 1, 2, 3 } a[#a + 1] = %I table.sort(a)",
        "NoSuchFunction%I()",
        "if %I % 2 == 0 then x = 1 else x = 2 end",
        "$$ not lua $$",
    ],
    js: [
        "nSoak = %I + 1;",
        'cSoak = "row " + %I + " of many";',
        "{ const a = [1, 2, 3]; a.push(%I); a.sort((p, q) => p - q); }",
        "NoSuchFunction%I()",
        "if (%I % 2 === 0) x = 1; else x = 2;",
        "$$ not js $$",
    ],
};

// Universal garbage — the same bytes for every engine, since garbage has no
// idiom. Language-shaped fuzzing (tests/fuzz.js) stays Ring-only.
function hostileCases() {
    const NASTY = [
        "", " ", "\0", "a \0 b", "￿￾",
        "\x01\x02\x03\x1b\x7f",
        "见 = 1",
        '"' + "\\".repeat(500),
        '"unterminated',
        "(", "(".repeat(2000),
        "[".repeat(2000) + "]".repeat(2000),
        "1+".repeat(5000) + "1",
        "x".repeat(20000),
        '"' + "A".repeat(20000) + '"',
        "\n".repeat(10000),
        "1/0",
    ];
    let a = 20260807 >>> 0;
    const rand = () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const cases = NASTY.slice();
    const target = QUICK ? 300 : 1200;
    while (cases.length < target) {
        let s = "";
        const n = 1 + Math.floor(rand() * 200);
        for (let i = 0; i < n; i++) s += String.fromCharCode(Math.floor(rand() * 0x2000));
        cases.push(s);
    }
    return cases;
}

/* ------------------------------------------------------------------ main */

(async () => {
    const engines = [await ringAdapter(), await luaAdapter(), await quickjsAdapter()];
    const results = { date: new Date().toISOString().slice(0, 10), quick: QUICK, engines: {} };
    for (const e of engines) results.engines[e.lang] = { name: e.name, wasmBytes: e.wasmBytes };

    const w = (s, n) => String(s).padEnd(n);
    const r = (s, n) => String(s).padStart(n);

    console.log("RingScript vs. peers" + (QUICK ? "  (quick — numbers are rough)" : ""));
    for (const e of engines) {
        console.log("  " + w(e.name, 30) + r(e.wasmBytes.toLocaleString(), 9) + " bytes wasm   (" + e.freshNote + ")");
    }

    /* ---- startup: a fresh isolated evaluator, module already compiled */
    console.log("\n" + w("fresh evaluator", 30) + r("min ms", 9) + r("median", 9));
    console.log("-".repeat(48));
    for (const e of engines) {
        const s = await measure(async () => { const h = await e.fresh(); h.run(""); h.dispose(); }, 20, 400);
        results.engines[e.lang].fresh = { min: +s.min.toFixed(3), median: +s.median.toFixed(3) };
        console.log(w(e.name, 30) + r(s.min.toFixed(2), 9) + r(s.median.toFixed(2), 9));
    }

    /* ---- the scenario table */
    console.log("\n" + w("scenario (min ms)", 30) + engines.map((e) => r(e.lang, 10)).join("") + "   winner");
    console.log("-".repeat(30 + engines.length * 10 + 9));
    for (const sc of SCENARIOS) {
        const row = {};
        for (const e of engines) {
            const spec = sc[e.lang];
            if (!spec) { row[e.lang] = null; continue; }
            const h = await e.fresh();
            let setupOk = true;
            const doSetup = (code) => { const res = h.run(code); if (!res.ok) { setupOk = false; console.error("  SETUP FAILED " + sc.id + "/" + e.lang + ": " + String(res.error).slice(0, 90)); } };
            if (spec.setupFromAdapter && e[spec.setupFromAdapter]) doSetup(e[spec.setupFromAdapter]);
            if (spec.setup2) doSetup(spec.setup2);
            if (spec.setup) doSetup(spec.setup);
            if (!setupOk) { row[e.lang] = null; h.dispose(); continue; }
            const first = h.run(spec.body);
            if (!first.ok) { console.error("  BODY FAILED " + sc.id + "/" + e.lang + ": " + String(first.error).slice(0, 90)); row[e.lang] = null; h.dispose(); continue; }
            if (spec.probe !== undefined) {
                const got = h.get(spec.probe);
                if (got !== spec.expect) { console.error("  PROBE FAILED " + sc.id + "/" + e.lang + ": got " + got + " want " + spec.expect); row[e.lang] = null; h.dispose(); continue; }
            }
            const s = await measure(async () => { h.run(spec.body); }, sc.reps, sc.minMs);
            row[e.lang] = +s.min.toFixed(3);
            h.dispose();
        }
        const best = Object.entries(row).filter(([, v]) => v !== null).sort((a, b) => a[1] - b[1])[0];
        results[sc.id] = row;
        console.log(w(sc.label + (sc.jsonNote && sc.id !== "json-1mb" ? " *" : sc.jsonNote ? " *" : ""), 30) +
            engines.map((e) => r(row[e.lang] === null ? "-" : row[e.lang].toFixed(row[e.lang] < 10 ? 3 : 1), 10)).join("") +
            "   " + (best ? best[0] : "-"));
    }
    console.log("  * JSON: QuickJS's and (since HEADROOM_PLAN P2) Ring's codecs are");
    console.log("    native C; Lua's is pure Lua. The row measures what a C codec buys.");

    /* ---- endurance: the soak, scaled down */
    const BATCHES = QUICK ? 2 : 4, PER = QUICK ? 800 : 2500;
    console.log("\nendurance — " + BATCHES + " batches x " + PER.toLocaleString() +
        " evals, errors included (heap = engine's own accounting)");
    console.log(w("", 30) + r("heap start", 12) + r("heap end", 12) + r("growth", 10) + r("survived", 10));
    console.log("-".repeat(74));
    for (const e of engines) {
        const h = await e.fresh();
        h.run(SOAK[e.lang][0].replace(/%I/g, "1"));
        const startB = h.heapBytes();
        let deaths = 0;
        for (let b = 0; b < BATCHES; b++) {
            for (let i = 0; i < PER; i++) {
                const code = SOAK[e.lang][i % SOAK[e.lang].length].replace(/%I/g, String(i));
                try { h.run(code); } catch (err) { deaths++; }
            }
        }
        const endB = h.heapBytes();
        const canary = h.get(e.lang === "ring" ? "6 * 7" : "6 * 7");
        const alive = canary === "42";
        results.engines[e.lang].soak = {
            evals: BATCHES * PER, heapStartMB: +(startB / 1048576).toFixed(2),
            heapEndMB: +(endB / 1048576).toFixed(2), survived: alive,
        };
        console.log(w(e.name, 30) +
            r((startB / 1048576).toFixed(2) + " MB", 12) +
            r((endB / 1048576).toFixed(2) + " MB", 12) +
            r("+" + ((endB - startB) / 1048576).toFixed(2) + " MB", 10) +
            r(alive ? "yes" : "NO", 10));
        h.dispose();
    }

    /* ---- hostility: the same garbage into every engine */
    const cases = hostileCases();
    console.log("\nhostile input — " + cases.length + " identical garbage cases into each engine");
    console.log(w("", 30) + r("accepted", 10) + r("rejected", 10) + r("deaths", 8) + r("recovered", 11));
    console.log("-".repeat(69));
    for (const e of engines) {
        let h = await e.fresh();
        let accepted = 0, rejected = 0, deaths = 0, unrecovered = 0;
        for (let i = 0; i < cases.length; i++) {
            let res;
            try { res = h.run(cases[i]); }
            catch (err) { res = { ok: false, error: String(err), escaped: true }; }
            if (res.ok) accepted++; else rejected++;
            if (i % 100 === 99) {
                let canary = "";
                try { canary = h.get("6 * 7"); } catch (err) { canary = "THREW"; }
                if (canary !== "42") {
                    deaths++;
                    h.dispose();
                    try { h = await e.fresh(); if (h.get("6 * 7") !== "42") unrecovered++; }
                    catch (err) { unrecovered++; }
                }
            }
        }
        let finalAlive = false;
        try { finalAlive = h.get("6 * 7") === "42"; } catch (err) {}
        results.engines[e.lang].hostile = { cases: cases.length, accepted, rejected, deaths, unrecovered, finalAlive };
        console.log(w(e.name, 30) + r(accepted, 10) + r(rejected, 10) + r(deaths, 8) +
            r(deaths === 0 ? "n/a" : (unrecovered === 0 ? "always" : "FAILED x" + unrecovered), 11));
        h.dispose();
    }

    if (JSON_OUT) {
        fs.writeFileSync(path.join(__dirname, JSON_OUT), JSON.stringify(results, null, 2) + "\n");
        console.log("\nresults written to " + JSON_OUT);
    }
    console.log("\ndone.");
    process.exit(0);
})().catch((e) => { console.error("rivals harness crashed:", e); process.exit(1); });
