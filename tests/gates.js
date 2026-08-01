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
        const multi = ring.eval("a = 1\nb = 2\nsomeUnknownFunc()\nc = 3");
        check("multi-line eval reports the real line (3)", !multi.ok && multi.error.startsWith("line 3:"), multi.error);
        const multi2 = ring.eval('x1 = 10\nx2 = x1 + 5\nx3 = x2 * 2\nsee "v=" + x3 + nl\nbadCall()');
        check("error on line 5 reports line 5, prior output kept", !multi2.ok && multi2.error.startsWith("line 5:") && multi2.output === "v=30\n", JSON.stringify(multi2));
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

    async p4() {
        console.log("P4 — two-way bridge (rs_call + jscall)");
        const ring = await newVM();

        const enc = ring.eval('see JsonEncode([ :name = "Aminata", :tags = ["a","b"], :note = "l1" + char(10) + "l2" ])');
        check("JsonEncode pair-list -> object", enc.output === '{"name":"Aminata","tags":["a","b"],"note":"l1\\nl2"}', enc.output);

        ring.eval('func Double aData return [ :value = aData[:n] * 2 ]');
        const call = ring.call("Double", { n: 21 });
        check("rs_call JSON in/out", call.ok && call.result && call.result.value === 42, JSON.stringify(call));

        ring.eval('load "ringlib/stzzql_smoke.ring"');
        ring.eval('func RunCollect aData\n' +
            '  cQ = char(34)\n' +
            '  o = StzZqlQ("DEFINE FLOW :collect (STEP 1: RECORD -> { ACTOR: :collector, VALIDATE: :member != " + cQ + cQ + ", ON_FAIL: REJECT " + cQ + "NO_MEMBER" + cQ + " })")\n' +
            '  return o.RunFlow("collect", aData)');
        const flow = ring.call("RunCollect", { member: "Aminata", amount: 5000 });
        check("stzZql flow result returns as JSON", flow.ok && flow.result.status === "complete", JSON.stringify(flow.result));
        const rejected = ring.call("RunCollect", { member: "", amount: 5000 });
        check("flow rejection visible in JSON", rejected.ok && rejected.result.status === "failed" && rejected.result.actionarg === "NO_MEMBER", JSON.stringify(rejected.result));

        let seen = null;
        ring.on("notify", p => { seen = p; return { ack: 1 }; });
        const js = ring.eval('a = Platform("notify", [ :msg = "hi" ]) see a[:ack]');
        check("jscall reaches JS handler", seen && seen.msg === "hi", JSON.stringify(seen));
        check("JS reply returns to Ring", js.ok && js.output === "1", JSON.stringify(js));

        const bad = ring.call("NoSuchFunction", {});
        check("unknown function traps cleanly", !bad.ok && bad.error.includes("without definition"), bad.error);
    },

    async io() {
        console.log("IO — give input, object printing, auto-main (examples challenge)");
        const ring = await newVM();
        // NOTE: the object test runs BEFORE any give on this VM. Upstream
        // Ring 1.27 (reproduced on native ring.exe with the default stdin
        // give) corrupts the first attribute of a later attribute-only
        // class after any give executes — not a wasm/bridge defect.
        const obj = ring.eval("new point { x=10 y=20 z=30 ? self }\nclass point x y z");
        check("attribute-only class + new + ? self", obj.ok && obj.output === "x: 10\ny: 20\nz: 30\n\n", JSON.stringify(obj.output));
        const give = ring.eval('? "Name: " give n ? "Hi " + n', "Alice\n");
        check("give consumes queued input and echoes", give.ok && give.output === "Name: \nAlice\nHi Alice\n", JSON.stringify(give.output));
        const dry = ring.eval("give x", "");
        check("exhausted input traps instead of spinning", !dry.ok && dry.error.includes("exhausted"), dry.error);
        const ring2 = await newVM();
        const main = ring2.eval('nCount = 10\nfunc main\n    nID = 1\n    see "Count = " + nCount + nl + "ID = " + nID');
        check("func main auto-runs after top-level code", main.ok && main.output === "Count = 10\nID = 1", JSON.stringify(main.output));
        const again = ring2.eval("see 1");
        check("main does not re-run on later evals", again.ok && again.output === "1", JSON.stringify(again.output));
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
