/*
** RingScript benchmark harness — so performance cannot regress quietly.
**
** Nothing here proves RingScript is fast. It proves it is not getting
** slower: every number is compared against tests/bench-baseline.json, and
** a regression beyond the tolerance fails the run. Before this existed, a
** change that doubled any of these would have shipped unnoticed.
**
** Two things make a committed baseline honest across machines:
**
**   · Calibration. Wall-clock milliseconds are meaningless on someone
**     else's laptop, so each run also times a fixed pure-JS workload and
**     compares RATIOS. A machine half as fast scales both, and the
**     comparison holds.
**   · Minimum, not mean. Timing noise is always additive — a sample is
**     never faster than the truth — so the minimum of many runs is the
**     cleanest estimator available, and the median is printed beside it
**     to show the spread.
**
** Size is measured too, and gated harder. This project has twice chosen a
** smaller binary over a faster one (ReleaseSmall over ReleaseFast, the
** Ring ZQL over the Zig one); a benchmark that watched only speed would
** quietly reward the trade it has already rejected.
**
** Usage:
**   node tests/bench.js              measure and compare
**   node tests/bench.js --update     re-record the baseline (say why in the commit)
**   node tests/bench.js --quick      fewer repetitions, for a fast local look
*/
const fs = require("fs");
const os = require("os");
const path = require("path");
const RingScript = require(path.join(__dirname, "..", "playground", "ringscript.js"));

const WASM = path.join(__dirname, "..", "playground", "ringscript.wasm");
const BASELINE = path.join(__dirname, "bench-baseline.json");
const UPDATE = process.argv.includes("--update");
const QUICK = process.argv.includes("--quick");

// How much worse than baseline is a failure. Generous, because this must
// never cry wolf: a flaky benchmark gets ignored, and an ignored benchmark
// protects nothing. It still catches the doubling the plan was worried about.
const SPEED_TOLERANCE = 1.40;
// Size is deterministic — no calibration, no noise — so it is held tight.
const SIZE_TOLERANCE = 1.02;

const ms = (ns) => Number(ns) / 1e6;

/* ------------------------------------------------------------------ timing */

function stats(samples) {
    const sorted = samples.slice().sort((a, b) => a - b);
    return { min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], n: sorted.length };
}

/** Run `fn` until both minimums are met, and report min/median. */
async function measure(fn, minReps, minMs, full) {
    // --quick never shortens the calibration: with too few samples the
    // minimum has not settled, and every comparison is scaled by it.
    if (QUICK && !full) { minReps = Math.max(3, Math.round(minReps / 5)); minMs = minMs / 5; }
    for (let i = 0; i < 3; i++) await fn();                 // warm up
    const samples = [];
    const started = process.hrtime.bigint();
    while (samples.length < minReps || ms(process.hrtime.bigint() - started) < minMs) {
        const t0 = process.hrtime.bigint();
        await fn();
        samples.push(ms(process.hrtime.bigint() - t0));
    }
    return stats(samples);
}

/**
 * A fixed pure-JS workload, timed the same way. Its only job is to say how
 * fast the machine underneath is, so baselines taken elsewhere still mean
 * something.
 *
 * Half integer arithmetic, half a strided walk over 4 MB. Interpreting Ring
 * is not pure ALU work - it chases pointers through the VM's structures -
 * so a calibration that never left the registers would call a machine with
 * fast cores and slow memory faster than it is for this workload.
 *
 * Self-contained and allocation-free after the first call, so no library or
 * GC behaviour leaks in.
 */
const CALIB_MEM = new Int32Array(1 << 20);
function calibrationWorkload() {
    let a = 12345 >>> 0;
    for (let i = 0; i < 200000; i++) {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        a = (t ^ (t >>> 14)) >>> 0;
    }
    // Stride by 16 int32s = one 64-byte cache line, so every step misses.
    for (let i = 0; i < CALIB_MEM.length; i += 16) {
        a = (a + CALIB_MEM[i]) >>> 0;
        CALIB_MEM[i] = a | 1;
    }
    return a;
}

/* -------------------------------------------------------------- benchmarks */

// `setup` runs once on a shared VM; `body` is what gets timed, and is kept
// declaration-free on purpose — a `class` or `func` in the timed path would
// make the bridge append a region terminator on every repetition and the
// benchmark would measure the accumulation instead of the work.
const ZQL_SRC = [
    'DEFINE ENTITY deposit (',
    '  id: uuid,',
    '  member: text,',
    '  amount: currency,',
    '  round: int,',
    '  status: enum("STAGED", "AUDITED", "ACTIVE")',
    ') RATIONALE "One contribution to one round"',
    '',
    'DEFINE NORM positive_deposit AS (',
    '  RULE: amount > 0,',
    '  MESSAGE: "A deposit must bring something"',
    ')',
].join("\n");

const BENCHES = [
    {
        id: "startup", label: "instantiate + rs_init", unit: "cold start",
        reps: 30, minMs: 700, fresh: true,
    },
    {
        id: "eval-min", label: "? 1+1", unit: "one round trip",
        reps: 300, minMs: 300,
        body: "? 1+1",
    },
    {
        id: "loop-10k", label: "10,000-iteration loop", unit: "VM dispatch",
        reps: 120, minMs: 300,
        body: "x = 0\nfor i = 1 to 10000 x = i next",
    },
    {
        id: "string-2k", label: "build a 2,000-char string", unit: "string growth",
        reps: 120, minMs: 300,
        body: 'c = ""\nfor i = 1 to 2000 c += "x" next',
    },
    {
        id: "sort-2k", label: "sort a 2,000-element list", unit: "library call",
        reps: 60, minMs: 300,
        // Built once, sorted from scratch every repetition: Ring's sort()
        // returns a new list, so the input stays unsorted and the work is
        // identical each time.
        setup: "aRnd = []\ns = 12345\nfor i = 1 to 2000\n" +
               "  s = (s * 1103515245 + 12345) % 2147483648\n  aRnd + s\nnext",
        body: "aSorted = sort(aRnd)",
    },
    {
        id: "objects-2k", label: "create 2,000 objects", unit: "allocation",
        reps: 60, minMs: 300,
        setup: "class BenchPoint\n  bpx bpy bpz",
        body: "for i = 1 to 2000 oPt = new BenchPoint next",
    },
    {
        id: "output-1k", label: "1,000 lines of output", unit: "see hook",
        reps: 60, minMs: 300,
        body: 'for i = 1 to 1000 see "line " + i + nl next',
    },
    {
        id: "json-encode", label: "JSON encode 8.7 KB", unit: "bridge codec",
        reps: 25, minMs: 300,
        // No `load` here: json.ring is already resident (the bridge builds
        // ring.call's glue on it), and loading it a second time fails.
        // Encode and decode are separate lines because they are not the same
        // cost — decoding is twice encoding — so a future optimisation of
        // one should not be able to hide behind the other.
        setup: "aBench = []\nfor i = 1 to 200\n" +
               '  aBench + [ ["id", i], ["name", "member " + i], ["amount", i * 1.5] ]\nnext\n' +
               "cJBench = JsonEncode(aBench)",
        body: "cJ = JsonEncode(aBench)",
    },
    {
        id: "json-decode", label: "JSON decode 8.7 KB", unit: "bridge codec",
        reps: 25, minMs: 300,
        setup: "aBench = []\nfor i = 1 to 200\n" +
               '  aBench + [ ["id", i], ["name", "member " + i], ["amount", i * 1.5] ]\nnext\n' +
               "cJBench = JsonEncode(aBench)",
        body: "aBack = JsonDecode(cJBench)",
    },
    {
        id: "call-bridge", label: "ring.call across the bridge", unit: "JS -> Ring",
        reps: 200, minMs: 300,
        setup: "func BenchAdd p\n  return len(p) + 1",
        call: ["BenchAdd", [1, 2, 3]],
    },
    {
        id: "zql-parse", label: "parse a ZQL declaration", unit: "shipped payload",
        reps: 30, minMs: 400,
        setup: 'load "ringlib/stzZql.ring"\ncZqlBench = \'' + ZQL_SRC + "'",
        body: "oZ = StzZqlQ(cZqlBench)",
    },
];

/* -------------------------------------------------------------------- main */

(async () => {
    const buf = fs.readFileSync(WASM);
    // One shared buffer -> one compiled Module: "instantiate + rs_init" below
    // now measures what a page pays per instance AFTER the first, which is
    // the number that matters since P1 of docs/HEADROOM_PLAN.md.
    const shared = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const bytes = () => shared;
    const newVM = () => RingScript.load(bytes(), { onOutput: () => {} });

    const base = fs.existsSync(BASELINE)
        ? JSON.parse(fs.readFileSync(BASELINE, "utf8")) : null;

    console.log("RingScript benchmarks" + (QUICK ? "  (quick)" : ""));
    console.log("  " + os.cpus()[0].model.trim());
    console.log("  node " + process.versions.node + " on " + process.platform +
                "   wasm " + buf.length.toLocaleString() + " bytes\n");

    // Calibrate first, and again at the end, so a machine that throttles or
    // gets busy mid-run is visible rather than silently blamed on the code.
    const calibA = (await measure(async () => calibrationWorkload(), 30, 300, true)).min;

    const results = {};
    const rows = [];
    let failures = 0;

    /** Measure one benchmark. Returns null (having reported) if it cannot run. */
    async function runBench(b) {
        if (b.fresh) {
            // Extra warm-up: this is the one benchmark that builds and throws
            // away a whole VM per repetition, so the collector, not the code,
            // decides the first few samples. Its minimum drifts ~17% until
            // the heap settles.
            for (let i = 0; i < 12; i++) await newVM();
            return measure(async () => { await newVM(); }, b.reps, b.minMs);
        }
        const vm = await newVM();
        if (b.setup) {
            const r = vm.eval(b.setup);
            if (!r.ok) { console.log("  SETUP FAILED  " + b.id + ": " + r.error); return null; }
        }
        if (b.call) {
            const probe = vm.call(b.call[0], b.call[1]);
            if (probe && probe.ok === false) {
                console.log("  SETUP FAILED  " + b.id + ": " + probe.error); return null;
            }
            return measure(async () => { vm.call(b.call[0], b.call[1]); }, b.reps, b.minMs);
        }
        const probe = vm.eval(b.body);
        if (!probe.ok) { console.log("  BODY FAILED  " + b.id + ": " + probe.error); return null; }
        return measure(async () => { vm.eval(b.body); }, b.reps, b.minMs);
    }

    for (const b of BENCHES) {
        const stat = await runBench(b);
        if (!stat) { failures++; continue; }
        results[b.id] = { min: +stat.min.toFixed(4), median: +stat.median.toFixed(4), n: stat.n };
        rows.push({ b, stat });
    }

    const calibB = (await measure(async () => calibrationWorkload(), 30, 300, true)).min;
    const calib = Math.min(calibA, calibB);
    const drift = Math.abs(calibA - calibB) / calib;

    /* --------------------------------------------------------------- report */

    const w = (s, n) => String(s).padEnd(n);
    const r = (s, n) => String(s).padStart(n);
    console.log(w("benchmark", 30) + r("min ms", 9) + r("median", 9) + r("vs base", 10) + "  ");
    console.log("-".repeat(60));

    // Scale the baseline to this machine before comparing.
    const scaleOf = (id) => base.results[id].min * (calib / base.calibration.min);
    const pct = (ratio) => (ratio < 1 ? "" : "+") + ((ratio - 1) * 100).toFixed(0) + "%";

    const suspects = [];
    for (const { b, stat } of rows) {
        let verdict = "", flag = "";
        if (base && base.results && base.results[b.id]) {
            const ratio = stat.min / scaleOf(b.id);
            verdict = pct(ratio);
            if (ratio > SPEED_TOLERANCE) { flag = "  ?"; suspects.push(b); }
            else if (ratio < 0.75) flag = "  faster";
        } else {
            verdict = base ? "new" : "-";
        }
        console.log(w(b.label, 30) + r(stat.min.toFixed(3), 9) +
                    r(stat.median.toFixed(3), 9) + r(verdict, 10) + flag);
    }

    // Anything over the line is measured a second time before it is called a
    // regression. A machine is not a quiet place — a background process
    // landing on the wrong core inflates one benchmark and nothing else —
    // and a suite that reports a regression that isn't there gets ignored,
    // which protects nothing. Sensitivity is unaffected: a real slowdown is
    // still there on the second look, and the debug build fails both.
    if (suspects.length) {
        console.log("\n  re-measuring " + suspects.length +
                    " over the line (" + suspects.map((b) => b.id).join(", ") + ")");
        for (const b of suspects) {
            const again = await runBench(b);
            if (!again) { failures++; continue; }
            const ratio = again.min / scaleOf(b.id);
            const confirmed = ratio > SPEED_TOLERANCE;
            if (confirmed) failures++;
            console.log("    " + w(b.label, 28) + r(again.min.toFixed(3), 9) +
                        r(pct(ratio), 9) +
                        (confirmed ? "  REGRESSION" : "  transient, cleared"));
        }
    }

    /* ----------------------------------------------------------------- size */

    console.log();
    let sizeVerdict = "-";
    if (base && base.wasmBytes) {
        const ratio = buf.length / base.wasmBytes;
        const delta = buf.length - base.wasmBytes;
        sizeVerdict = (delta >= 0 ? "+" : "") + delta.toLocaleString() + " bytes  (" +
            (delta >= 0 ? "+" : "") + ((ratio - 1) * 100).toFixed(2) + "%)";
        if (ratio > SIZE_TOLERANCE) {
            console.log("  SIZE REGRESSION  " + buf.length.toLocaleString() + " bytes, " + sizeVerdict);
            console.log("    This project trades speed for size deliberately. If the growth is");
            console.log("    intended, re-record with --update and say why in the commit message.");
            failures++;
        } else {
            console.log("  wasm size        " + buf.length.toLocaleString() + " bytes  " + sizeVerdict);
        }
    } else {
        console.log("  wasm size        " + buf.length.toLocaleString() + " bytes");
    }

    if (drift > 0.15) {
        console.log("\n  NOTE  the machine changed speed mid-run (" +
            (drift * 100).toFixed(0) + "% between calibrations).");
        console.log("        Close other work and re-run before believing a regression.");
    }

    /* ------------------------------------------------------------- baseline */

    if (UPDATE) {
        const out = {
            recorded: new Date().toISOString().slice(0, 10),
            machine: os.cpus()[0].model.trim(),
            node: process.versions.node,
            platform: process.platform,
            wasmBytes: buf.length,
            calibration: { min: +calib.toFixed(4) },
            results,
        };
        fs.writeFileSync(BASELINE, JSON.stringify(out, null, 2) + "\n");
        console.log("\nBaseline re-recorded in tests/bench-baseline.json.");
        process.exit(0);
    }

    if (!base) {
        console.log("\nNo baseline yet — run with --update to record one.");
        process.exit(0);
    }

    console.log("\nbaseline: " + base.recorded + ", " + base.machine +
        " (calibration " + base.calibration.min.toFixed(1) + " ms, here " + calib.toFixed(1) + " ms)");
    console.log(failures
        ? "\n" + failures + " benchmark regression(s)."
        : "\nNo regressions.");
    process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("bench crashed:", e); process.exit(1); });
