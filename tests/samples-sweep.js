/*
** Bulk robustness sweep: run Ring's own sample programs (D:\ring127\samples)
** through native ring.exe AND the wasm engine, and compare.
**
** Classification per sample (by static scan):
**   compare  — deterministic, self-contained: outputs must match exactly
**   nocrash  — uses random/clock/date/time/input: wasm just must not crash
**   skip     — needs things wasm excludes by design (files, OS, GUI, load
**              of sibling/library files, threads, sockets) or interactive
**
** Usage: node tests/samples-sweep.js [--dirs Language,General] [--list] [--verbose]
** Env:   RING_HOME / RING_EXE point at the Ring installation; otherwise the
**        `ring` interpreter is found on PATH (see tests/ring-exe.js).
*/
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { Worker } = require("worker_threads");

const ringWhere = require(path.join(__dirname, "ring-exe.js"));
const RING_HOME = ringWhere.ringHome();
const RING_EXE = ringWhere.ringExe();
const SAMPLES = path.join(RING_HOME, "samples");
const wasmPath = path.join(__dirname, "..", "playground", "ringscript.wasm");

const argRoot = (process.argv.find(a => a.startsWith("--root=")) || "").replace("--root=", "");
const ROOT = argRoot ? path.resolve(argRoot) : SAMPLES;
const argDirs = (process.argv.find(a => a.startsWith("--dirs=")) || "").replace("--dirs=", "");
const DIRS = argDirs ? argDirs.split(",") : ["AQuickStart", "Language", "Algorithms", "DataStructure", "ProblemSolving", "General"];
const LIST_ONLY = process.argv.includes("--list");
const VERBOSE = process.argv.includes("--verbose");

// Constructs excluded by design in the browser runtime (or untestable here)
const SKIP_PATTERNS = [
    [/\bload\s+["']/i, "load (multi-file / library)"],
    [/\bimport\s+/i, "import package from lib"],
    [/\bsystem\s*\(/i, "system()"],
    [/\b(fopen|fwrite|fread\s*\(|write\s*\(|read\s*\(|remove\s*\(|rename\s*\(|dir\s*\(|fexists|rewind|fseek|ftell|feof|fgetc|fgets|fputs|fputc|fflush|perror|tempfile|tempname)\b/i, "file functions"],
    [/\b(chdir|currentdir|exefilename|exefolder|sysget|shutdown|getarg|sysargv|windowsnl|currentpath|prevfilename)\b/i, "OS functions"],
    [/\b(new_thread|thread|mutex)\w*\s*\(/i, "threads"],
    [/\bcallgc\s*\(|\bringvm_/i, "VM introspection (env-specific output)"],
    [/\binput\s*\(|\bgetchar\s*\(|\bgetnumber\s*\(|\bgetstring\s*\(/i, "interactive input fns"],
    [/ChangeRingKeyword|ChangeRingOperator|LoadSyntax/i, "keyword changes (state-global)"],
    [/\braylib|sdl|glut|opengl|qt\b/i, "graphics"],
    // Environment-specific output: pointer addresses, host paths, host OS,
    // the C-function/global registries (the bridge adds its own entries)
    [/\b(varptr|objectid|nullpointer|object2pointer|pointer2object|getpointer|setpointer|space\s*\(\s*\)|exefilename)\b/i, "pointer addresses (env-specific)"],
    [/\b(filename|prevfilename)\s*\(/i, "source path (env-specific)"],
    [/\b(iswindows|iswindows64|isunix|ismacosx|islinux|isfreebsd|ismsdos|isandroid|getarch|nofprocessors|uptime)\s*\(/i, "host OS checks (env-specific)"],
    [/\b(cfunctions|functions|globals|locals|classes|packages|packageclasses)\s*\(/i, "registry reflection (bridge adds entries)"],
    [/"[^"\n]+\.(txt|csv|dat|db|json)"/i, "reads a data file"],
];

// Path-based exclusions: perf benchmarks and clock-bound loops are too slow
// under a 15s wasm budget to be meaningful.
const SKIP_PATHS = [
    /\\Performance\\/i,
    /RateCounter/i,
    /\\SyntaxFiles\\/i,          // multi-file samples (sibling syntax file)
    /SendMoreMoneyMonteCarlo/i,  // random search, perf-bound past the budget
];

// Nondeterministic but must run without crashing
const NOCRASH_PATTERNS = [
    [/\brandom\s*\(|\bsrandom\s*\(/i, "random"],
    [/\bclock\s*\(|\bclockspersecond\s*\(/i, "clock"],
    [/\b(time|date|timelist|adddays|diffdays)\s*\(/i, "date/time"],
    [/\bgive\b/i, "give (canned input)"],
    [/\bget\s+\w/i, "get — second-style give (canned input)"],
    [/\bbye\b/i, "bye — ends the whole program"],
];

// Digit-heavy: menu samples compare give input against numbers, and a
// non-numeric line is a legitimate R41 on both sides — keep it comparable.
const CANNED_INPUT = "3\n7\n2\n4\n1\n9\n8\n5\n5\n5\n5\n5\n5\n5\n";

function classify(src) {
    for (const [re, why] of SKIP_PATTERNS) if (re.test(src)) return { kind: "skip", why };
    for (const [re, why] of NOCRASH_PATTERNS) if (re.test(src)) return { kind: "nocrash", why };
    return { kind: "compare" };
}

function runNative(file, input) {
    try {
        const out = execFileSync(RING_EXE, [file], {
            input: input || "",
            timeout: 10000,
            maxBuffer: 32 * 1024 * 1024,
            cwd: path.dirname(file),
        });
        return { ok: true, out: out.toString("utf8").replace(/\r\n/g, "\n") };
    } catch (e) {
        return { ok: false, out: (e.stdout || "").toString(), err: String(e.message).split("\n")[0] };
    }
}

// Wasm evals run in a worker thread so hung samples (infinite loops) can be
// terminated; the worker is recreated after a timeout.
const WORKER_SRC = `
const { parentPort, workerData } = require("worker_threads");
const fs = require("fs");
const RingScript = require(workerData.loaderPath);
const buf = fs.readFileSync(workerData.wasmPath);
parentPort.on("message", async msg => {
    try {
        const ring = await RingScript.load(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), {
            captureStdout: true, onOutput: () => {},
        });
        const r = ring.eval(msg.code, msg.input);
        parentPort.postMessage({ id: msg.id, ok: true, output: r.output, error: r.error });
    } catch (e) {
        parentPort.postMessage({ id: msg.id, ok: false, crash: String(e.message) });
    }
});
`;

function makeWorker() {
    return new Worker(WORKER_SRC, {
        eval: true,
        workerData: {
            loaderPath: path.join(__dirname, "..", "playground", "ringscript.js"),
            wasmPath: wasmPath,
        },
    });
}

let worker = null;
let nextId = 1;
function wasmEval(code, input, timeoutMs) {
    if (!worker) worker = makeWorker();
    const id = nextId++;
    return new Promise(resolve => {
        const timer = setTimeout(() => {
            worker.removeListener("message", onMsg);
            worker.terminate();
            worker = null;
            resolve({ ok: false, timeout: true });
        }, timeoutMs);
        const onMsg = m => {
            if (m.id !== id) return;
            clearTimeout(timer);
            worker.removeListener("message", onMsg);
            resolve(m);
        };
        worker.on("message", onMsg);
        worker.postMessage({ id, code, input });
    });
}

function stripEchoes(out, input) {
    let s = out, from = 0;
    for (const line of (input || "").split("\n")) {
        if (!line) continue;
        const idx = s.indexOf(line + "\n", from);
        if (idx !== -1) { s = s.slice(0, idx) + s.slice(idx + line.length + 1); from = idx; }
    }
    return s;
}

(async () => {
    const files = [];
    for (const dir of DIRS) {
        const root = path.join(ROOT, dir);
        if (!fs.existsSync(root)) continue;
        const walk = d => {
            for (const e of fs.readdirSync(d, { withFileTypes: true })) {
                const p = path.join(d, e.name);
                if (e.isDirectory()) walk(p);
                else if (e.name.endsWith(".ring")) files.push(p);
            }
        };
        walk(root);
    }

    const tally = { match: 0, ran: 0, mismatch: 0, wasmfail: 0, nativefail: 0, skip: 0 };
    const failures = [];

    for (const file of files) {
        const rel = path.relative(ROOT, file);
        if (SKIP_PATHS.some(re => re.test(file))) {
            tally.skip++;
            if (LIST_ONLY || VERBOSE) console.log("SKIP      " + rel + "  (path-based)");
            continue;
        }
        const src = fs.readFileSync(file, "utf8");
        const cls = classify(src);
        if (cls.kind === "skip") {
            tally.skip++;
            if (LIST_ONLY || VERBOSE) console.log("SKIP      " + rel + "  (" + cls.why + ")");
            continue;
        }
        if (LIST_ONLY) { console.log(cls.kind.toUpperCase().padEnd(10) + rel); continue; }

        const input = cls.kind === "nocrash" ? CANNED_INPUT : "";
        const native = runNative(file, input);
        if (!native.ok) {
            tally.nativefail++;
            if (VERBOSE) console.log("NATFAIL   " + rel + "  (" + native.err + ")");
            continue; // native itself can't run it (missing data files etc.)
        }

        const res = await wasmEval(src, input, 15000);
        if (res.timeout) {
            tally.wasmfail++;
            failures.push({ rel, kind: "WASM TIMEOUT" });
            console.log("TIMEOUT   " + rel);
            continue;
        }
        if (!res.ok) {
            tally.wasmfail++;
            failures.push({ rel, kind: "WASM CRASH", detail: res.crash });
            console.log("CRASH     " + rel + "  " + res.crash);
            continue;
        }
        const wasmRes = { output: res.output, error: res.error };

        if (cls.kind === "nocrash") {
            if (wasmRes.error && !/exhausted/.test(wasmRes.error)) {
                tally.wasmfail++;
                failures.push({ rel, kind: "WASM ERROR", detail: wasmRes.error });
                console.log("ERR       " + rel + "  " + wasmRes.error);
            } else {
                tally.ran++;
                if (VERBOSE) console.log("RAN       " + rel + "  (" + cls.why + ")");
            }
            continue;
        }

        const got = stripEchoes(wasmRes.output, input);
        if (got === native.out && !wasmRes.error) {
            tally.match++;
            if (VERBOSE) console.log("MATCH     " + rel);
        } else {
            tally.mismatch++;
            failures.push({ rel, kind: "MISMATCH", native: native.out, wasm: got, error: wasmRes.error });
            console.log("DIFF      " + rel + (wasmRes.error ? "  [" + wasmRes.error + "]" : ""));
        }
    }

    if (LIST_ONLY) return;
    console.log("\n==== sweep summary ====");
    console.log("exact match : " + tally.match);
    console.log("ran (nondet): " + tally.ran);
    console.log("mismatch    : " + tally.mismatch);
    console.log("wasm fail   : " + tally.wasmfail);
    console.log("native fail : " + tally.nativefail + "  (oracle could not run; not counted)");
    console.log("skipped     : " + tally.skip + "  (by-design exclusions)");

    if (failures.length) {
        fs.writeFileSync(path.join(__dirname, "sweep-failures.json"), JSON.stringify(failures, null, 1));
        console.log("\nDetails in tests/sweep-failures.json");
    }
    if (worker) worker.terminate();
    process.exit(tally.mismatch + tally.wasmfail > 0 ? 1 : 0);
})().catch(e => { console.error("sweep crashed:", e); process.exit(1); });
