/*
** Probe 2 — the two questions that turn a ratio into a decision:
**   (1) SCALE:        where does the interpreted path stop being fast enough?
**   (2) AMORTISATION: the ledger's real pattern is cross once, operate many
**                     times. Does the plumbing tax survive being divided?
*/
const fs = require("fs"), path = require("path");
const REPO = "D:/GitHub/ringscript";
const RingScript = require(path.join(REPO, "playground", "ringscript.js"));

function stat(fn, reps) {
    const t = [];
    for (let i = 0; i < reps; i++) {
        const a = process.hrtime.bigint(); fn();
        t.push(Number(process.hrtime.bigint() - a) / 1e6);
    }
    t.sort((x, y) => x - y);
    return t[0];
}
const ms = (n) => n.toFixed(2).padStart(10);

(async () => {
    const w = fs.readFileSync(path.join(REPO, "playground", "ringscript.wasm"));
    const ring = await RingScript.load(
        w.buffer.slice(w.byteOffset, w.byteOffset + w.byteLength), { onOutput: () => {} });
    ring.eval(fs.readFileSync(__dirname + "/bench.ring", "utf8"));

    const k = await WebAssembly.instantiate(fs.readFileSync(__dirname + "/kernel.wasm"), {});
    const K = k.instance.exports;
    const kmem = new Float64Array(K.memory.buffer);
    const kbase = K.bufPtr() / 8;

    console.log("\n  (1) SCALE — the same aggregate, as the data grows\n");
    console.log("      rows   interpreted    compiled     crossing    ratio  interpreted");
    console.log("  " + "-".repeat(72));
    for (const rows of [2000, 20000, 100000, 400000]) {
        ring.call("BuildData", rows);
        const interp = stat(() => ring.call("SumWeighted", 1), 5);
        const exported = JSON.parse(ring.call("ExportData", 1).result);
        for (let i = 0; i < exported.length; i++) kmem[kbase + i] = exported[i];
        const comp = stat(() => K.sumWeighted(rows), 5);
        const cross = stat(() => {
            const a = JSON.parse(ring.call("ExportData", 1).result);
            for (let i = 0; i < a.length; i++) kmem[kbase + i] = a[i];
        }, 5);
        console.log("  " + String(rows).padStart(9) + ms(interp) + ms(comp) + ms(cross) +
                    (interp / comp).toFixed(0).padStart(9) + "x" +
                    (interp > 100 ? "   painful" : interp > 16 ? "   a frame" : "   invisible"));
    }

    console.log("\n  (2) AMORTISATION — 100 000 rows, cross once, then N aggregates");
    console.log("      (the ledger's real pattern: the user filters, sorts, re-reads)\n");
    ring.call("BuildData", 100000);
    const interp1 = stat(() => ring.call("SumWeighted", 1), 5);
    const crossOnce = stat(() => {
        const a = JSON.parse(ring.call("ExportData", 1).result);
        for (let i = 0; i < a.length; i++) kmem[kbase + i] = a[i];
    }, 5);
    const comp1 = stat(() => K.sumWeighted(100000), 5);
    console.log("      operations   stay in Ring   cross + compute   compiled wins by");
    console.log("  " + "-".repeat(72));
    for (const n of [1, 5, 20, 100]) {
        const a = interp1 * n, b = crossOnce + comp1 * n;
        console.log("  " + String(n).padStart(15) + ms(a) + ms(b) +
                    (a / b).toFixed(1).padStart(16) + "x");
    }
    console.log("\n      one crossing costs " + crossOnce.toFixed(1) + " ms = " +
                (crossOnce / interp1).toFixed(2) + " interpreted aggregates\n");
})().catch(e => { console.error(e); process.exit(1); });
