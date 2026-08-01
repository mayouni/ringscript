/*
** RingScript phase gates (REPAIR_PLAN.md §4) — runnable verification.
** Usage: node tests/gates.js [phase]   (no arg = run all available)
** Exits nonzero if any gate fails.
*/
const fs = require("fs");
const path = require("path");
const RingScript = require(path.join(__dirname, "..", "web", "ringscript.js"));

const wasmPath = path.join(__dirname, "..", "web", "ringscript.wasm");

let failures = 0;
function check(name, cond, detail) {
    console.log((cond ? "  PASS  " : "  FAIL  ") + name + (cond || detail === undefined ? "" : "  [" + detail + "]"));
    if (!cond) failures++;
}

async function newVM(opts) {
    const buf = fs.readFileSync(wasmPath);
    return RingScript.load(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), opts || { onOutput: () => {} });
}

const phases = {
    async p0() {
        console.log("P0 — toolchain: see 1+2 prints 3");
        const ring = await newVM();
        const r = ring.eval("see 1+2");
        check("see 1+2 -> 3", r.ok && r.output === "3", JSON.stringify(r));
    },

    async p1() {
        console.log("P1 — resident state + unbounded output");
        const ring = await newVM();
        ring.eval("x = 5");
        const r1 = ring.eval("see x");
        check("globals survive across evals", r1.output === "5", r1.output);
        const r2 = ring.eval('line = "0123456789012345678901234567890123456789"\nfor i = 1 to 30000 see line + nl next');
        const expected = 30000 * 41;
        check("1.23 MB output arrives whole", r2.output.length === expected, r2.output.length + " / " + expected);
        const lines = r2.output.split("\n");
        check("first/last lines intact", lines[0].length === 40 && lines[29999].length === 40);
    },

    async p2() {
        console.log("P2 — error trapping");
        const ring = await newVM();
        const bad = ring.eval("this is not ring");
        check("garbage returns nonzero", !bad.ok && bad.code !== 0);
        check("error carries line + message", /^line \d+: .*Error/.test(bad.error), bad.error);
        const rt = ring.eval("see 1\nsomeUnknownFunc()");
        check("runtime error trapped, prior output kept", !rt.ok && rt.output === "1", JSON.stringify(rt));
        ring.eval("y = 42");
        const after = ring.eval("see y");
        check("VM alive after errors, state intact", after.ok && after.output === "42");
        const heapBefore = ring.instance.exports.memory.buffer.byteLength;
        for (let i = 0; i < 500; i++) {
            const r = ring.eval("see " + i + "+1");
            if (!r.ok) { check("500-eval loop", false, "iteration " + i); return; }
        }
        for (let i = 0; i < 500; i++) {
            const r = ring.eval("nope nope " + i);
            if (r.ok) { check("500-error-eval loop", false, "iteration " + i); return; }
        }
        const heapAfter = ring.instance.exports.memory.buffer.byteLength;
        check("500 ok + 500 error evals complete", true);
        check("wasm memory bounded", heapAfter <= heapBefore + 16 * 1024 * 1024, heapBefore + " -> " + heapAfter);
        const fin = ring.eval("see y");
        check("state still intact after 1000 evals", fin.output === "42");
    },

    async p3() {
        console.log("P3 — embedded stzZql payload");
        const ring = await newVM();
        const r = ring.eval('load "ringlib/stzzql_smoke.ring"');
        check("smoke test loads via embedded map", r.ok, r.error);
        check("10 passed, 0 failed", r.output.includes("10 passed, 0 failed"), r.output.slice(-80));
        // load resolved a nested relative load too (smoke loads stzZql.ring)
        const q = ring.eval('o2 = StzZqlQ("DEFINE ENTITY :m (id: uuid)") see o2.CountEntities()');
        check("stzZql stays resident after load", q.ok && q.output === "1", JSON.stringify(q));
    },
};

(async () => {
    const which = process.argv[2] ? [process.argv[2]] : Object.keys(phases);
    for (const p of which) {
        if (!phases[p]) { console.error("unknown phase: " + p); process.exit(2); }
        await phases[p]();
    }
    console.log(failures === 0 ? "\nAll gates passed." : "\n" + failures + " gate(s) FAILED.");
    process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error("gate runner crashed:", e); process.exit(1); });
