/*
** RingScript soak test — does the resident VM survive a long session?
**
** The gates run ~1,000 evaluations. That is not enough: the class-per-eval
** leak fixed in P0 was invisible at 1,000 and reached 936 MB at 20,000 on
** ordinary page-style code. A resident VM is the product's whole premise, so
** something has to run one for a long time and watch what accumulates.
**
** Two phases, because they promise different things:
**
**   1. Declaration-free — what a live page does between definitions. Nothing
**      may accumulate at all. This is the P0 regression test.
**   2. Mixed — adds declarations and malformed declarations. One class per
**      declaring eval is inherent (the region terminator must be uniquely
**      named, since Ring rejects redefinition, and the class list never
**      shrinks), so here the promise is only that the heap stays bounded,
**      eval never throws, and the VM stays alive.
**
** Verdicts come from the final batches, after warm-up, so ordinary allocator
** growth is not mistaken for a leak.
**
** Usage: node tests/soak.js [batches] [evalsPerBatch]
*/
const fs = require("fs");
const path = require("path");
const RingScript = require(path.join(__dirname, "..", "playground", "ringscript.js"));

const BATCHES = parseInt(process.argv[2], 10) || 8;
const PER_BATCH = parseInt(process.argv[3], 10) || 2500;

const PAGE_WORKLOAD = [
    "nSoak = %I + 1",
    'cSoak = "row " + %I + " of many"',
    "aSoak = [1,2,3]  add(aSoak, %I)  aSoak = sort(aSoak)",
    "NoSuchFunction%I()",                     // runtime error
    "see %I",
    "if %I % 2 = 0  x = 1  else  x = 2  ok",
    "$$ not ring $$",                         // parse error, no keyword
];

const MIXED_WORKLOAD = PAGE_WORKLOAD.concat([
    "func SoakFn%I return %I",
    "func (",                                 // malformed declaration
    "class SoakCls%I gkA gkB",
]);

let failures = 0;
function check(name, cond, detail) {
    console.log((cond ? "  PASS  " : "  FAIL  ") + name +
        (cond || detail === undefined ? "" : "  [" + detail + "]"));
    if (!cond) failures++;
}

(async () => {
    const buf = fs.readFileSync(path.join(__dirname, "..", "playground", "ringscript.wasm"));
    const ring = await RingScript.load(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        { onOutput: () => {} });

    const mb = () => ring.instance.exports.memory.buffer.byteLength / 1048576;
    const count = (what) => {
        const r = ring.eval("see len(" + what + "())");
        return r.ok ? parseInt(r.output, 10) : NaN;
    };

    ring.eval("nCanary = 12345");             // must still answer at the end

    console.log("soak: " + BATCHES + " batches x " + PER_BATCH.toLocaleString() +
        " evaluations per phase\n");

    function run(work, label) {
        console.log("  " + label);
        console.log("  batch      heap MB   classes   functions   threw");
        const heap = [], classes = [], funcs = [];
        let threw = 0;
        for (let b = 0; b < BATCHES; b++) {
            let batchThrew = 0;
            for (let i = 0; i < PER_BATCH; i++) {
                const code = work[i % work.length].replace(/%I/g, String(i));
                try {
                    // eval must ALWAYS return a result object, never throw
                    const r = ring.eval(code);
                    if (typeof r !== "object" || typeof r.ok !== "boolean") batchThrew++;
                } catch (e) {
                    batchThrew++;
                }
            }
            threw += batchThrew;
            heap.push(mb());
            classes.push(count("classes"));
            funcs.push(count("functions"));
            console.log("  " + String(b + 1).padStart(5) + "   " +
                heap[b].toFixed(1).padStart(9) + "   " +
                String(classes[b]).padStart(7) + "   " +
                String(funcs[b]).padStart(9) + "   " +
                String(batchThrew).padStart(5));
        }
        console.log("");
        return { heap, classes, funcs, threw };
    }

    const tail = Math.max(2, Math.floor(BATCHES / 3));
    const grew = (a) => a[a.length - 1] - a[a.length - 1 - tail];

    // ---- phase 1: nothing at all may accumulate ---------------------------
    const page = run(PAGE_WORKLOAD, "phase 1 — declaration-free (what a live page does)");
    check("phase 1: eval never threw", page.threw === 0,
        page.threw + " of " + (BATCHES * PER_BATCH));
    check("phase 1: NO class accumulates", grew(page.classes) === 0,
        "+" + grew(page.classes) + " over the last " + tail + " batches (" +
        page.classes[0] + " -> " + page.classes[page.classes.length - 1] + ")");
    check("phase 1: no function accumulates", grew(page.funcs) === 0,
        "+" + grew(page.funcs));
    check("phase 1: heap flat", grew(page.heap) <= 16,
        "+" + grew(page.heap).toFixed(1) + " MB");

    // ---- phase 2: declarations are allowed to cost, crashes are not -------
    const mixed = run(MIXED_WORKLOAD, "phase 2 — mixed, with declarations");
    check("phase 2: eval never threw", mixed.threw === 0,
        mixed.threw + " of " + (BATCHES * PER_BATCH));
    check("phase 2: heap bounded", grew(mixed.heap) <= 64,
        "+" + grew(mixed.heap).toFixed(1) + " MB over the last " + tail + " batches");

    // ---- the VM is still the same VM, and still correct -------------------
    const canary = ring.eval("see nCanary");
    check("state survived the whole session", canary.ok && canary.output === "12345",
        JSON.stringify(canary).slice(0, 90));
    const still = ring.eval("see 6 * 7");
    check("VM still evaluates correctly", still.ok && still.output === "42",
        JSON.stringify(still).slice(0, 90));

    console.log(failures ? "\n" + failures + " soak check(s) FAILED." : "\nSoak clean.");
    process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("soak crashed:", e); process.exit(1); });
