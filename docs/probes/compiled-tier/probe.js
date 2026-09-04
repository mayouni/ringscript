/*
** The probe. One afternoon, one number, then the code gets deleted.
**
** A: pure arithmetic loop        -> the dispatch ceiling, zero plumbing
** B: walk/filter/weight a list   -> the ledger shape, compute only
** C: getting the list ACROSS     -> the plumbing tax, which is the part
**                                   that constrains a VM's data layout
*/
const fs = require("fs"), path = require("path");
const REPO = "D:/GitHub/ringscript";
const RingScript = require(path.join(REPO, "playground", "ringscript.js"));

const LOOP_N = 100000;
const ROWS = 20000;
const REPS = 9;

function stat(fn, reps) {
    const t = [];
    for (let i = 0; i < reps; i++) {
        const a = process.hrtime.bigint();
        fn();
        const b = process.hrtime.bigint();
        t.push(Number(b - a) / 1e6);
    }
    t.sort((x, y) => x - y);
    return { min: t[0], med: t[(t.length / 2) | 0] };
}
const ms = (n) => n.toFixed(3).padStart(9);
const row = (label, s, note) =>
    console.log("  " + label.padEnd(38) + ms(s.min) + ms(s.med) + "   " + (note || ""));

(async () => {
    // ---- the Ring VM, as any page would have it -----------------------
    const w = fs.readFileSync(path.join(REPO, "playground", "ringscript.wasm"));
    const ring = await RingScript.load(
        w.buffer.slice(w.byteOffset, w.byteOffset + w.byteLength), { onOutput: () => {} });
    const ev = ring.eval(fs.readFileSync(__dirname + "/bench.ring", "utf8"));
    if (!ev.ok) { console.error("bench.ring:", ev.error); process.exit(1); }

    // ---- the compiled kernel, instantiated at runtime ------------------
    const k = await WebAssembly.instantiate(fs.readFileSync(__dirname + "/kernel.wasm"), {});
    const K = k.instance.exports;
    const kmem = new Float64Array(K.memory.buffer);
    const kbase = K.bufPtr() / 8;

    console.log("\n  RingScript compiled-tier probe" +
                "\n  " + LOOP_N.toLocaleString() + "-iteration loop · " +
                ROWS.toLocaleString() + "-row aggregate · min/median of " + REPS +
                "\n\n" + "  workload".padEnd(40) + "    min ms   median\n" +
                "  " + "-".repeat(62));

    // ================= A. the dispatch ceiling =========================
    const ringLoop = stat(() => ring.call("BenchLoop", LOOP_N), REPS);
    const zigLoop  = stat(() => K.loopKernel(LOOP_N), REPS);
    row("A  loop, Ring (interpreted)", ringLoop);
    row("A  loop, Zig->wasm (compiled)", zigLoop,
        (ringLoop.min / zigLoop.min).toFixed(0) + "x");

    // sanity: the two must agree, or we are timing different work
    const rA = ring.call("BenchLoop", LOOP_N).result, zA = K.loopKernel(LOOP_N);
    console.log("     same answer? " + (Number(rA) === zA) + "   (" + rA + " / " + zA + ")");

    // ================= B. the ledger shape, compute only ===============
    ring.call("BuildData", ROWS);
    const exported = JSON.parse(ring.call("ExportData", 1).result);
    for (let i = 0; i < exported.length; i++) kmem[kbase + i] = exported[i];

    const ringSum = stat(() => ring.call("SumWeighted", 1), REPS);
    const zigSum  = stat(() => K.sumWeighted(ROWS), REPS);
    console.log("");
    row("B  aggregate, Ring (interpreted)", ringSum);
    row("B  aggregate, Zig->wasm (compiled)", zigSum,
        (ringSum.min / zigSum.min).toFixed(0) + "x");
    const rB = ring.call("SumWeighted", 1).result, zB = K.sumWeighted(ROWS);
    console.log("     same answer? " + (Number(rB) === zB) + "   (" + rB + " / " + zB + ")");

    // how much of the Ring aggregate is LIST ACCESS, not arithmetic?
    const ringWalk = stat(() => ring.call("WalkOnly", 1), REPS);
    row("B' the same walk, touching nothing", ringWalk,
        (100 * ringWalk.min / ringSum.min).toFixed(0) + "% of the aggregate");

    // ================= C. the plumbing tax =============================
    console.log("");
    const exportOnly = stat(() => ring.call("ExportData", 1), REPS);
    row("C  hand the list to the host (JSON)", exportOnly);
    const parseOnly = stat(() => JSON.parse(ring.call("ExportData", 1).result), REPS);
    row("C  ...parsed on the host", parseOnly);
    const fullCross = stat(() => {
        const a = JSON.parse(ring.call("ExportData", 1).result);
        for (let i = 0; i < a.length; i++) kmem[kbase + i] = a[i];
        return K.sumWeighted(a.length);
    }, REPS);
    row("C  ...copied in, then computed", fullCross,
        (fullCross.min / ringSum.min).toFixed(1) + "x the interpreted aggregate");

    console.log("\n  kernel.wasm: " + fs.statSync(__dirname + "/kernel.wasm").size + " bytes\n");
})().catch(e => { console.error(e); process.exit(1); });
