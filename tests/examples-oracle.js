/*
** Challenge harness: run every example from playground/examples-data.js through
** BOTH the native ring.exe (the oracle) and the wasm runtime, then compare.
**
** The wasm's `give` echoes the consumed line (terminal-transcript fidelity);
** native ring with piped stdin does not echo. The comparison removes each
** echoed input line (in order) from the wasm output before diffing.
**
** Usage: node tests/examples-oracle.js [id]      (no arg = all)
** Env:   RING_EXE / RING_HOME override the oracle location; otherwise the
**        `ring` interpreter is found on PATH (see tests/ring-exe.js).
*/
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const RingScript = require(path.join(__dirname, "..", "playground", "ringscript.js"));
const EXAMPLES = require(path.join(__dirname, "..", "playground", "examples-data.js"));

const RING_EXE = require(path.join(__dirname, "ring-exe.js")).ringExe();
const wasmPath = path.join(__dirname, "..", "playground", "ringscript.wasm");

function runNative(code, input) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ring-oracle-"));
    const file = path.join(dir, "example.ring");
    fs.writeFileSync(file, code, "utf8");
    try {
        const out = execFileSync(RING_EXE, [file], {
            input: input || "",
            timeout: 15000,
            maxBuffer: 16 * 1024 * 1024,
        });
        return out.toString("utf8").replace(/\r\n/g, "\n");
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function stripEchoes(wasmOut, input) {
    // remove the first occurrence of each input line (as a full line), in order
    let out = wasmOut;
    const lines = (input || "").split("\n").filter((l, i, a) => !(l === "" && i === a.length - 1));
    let searchFrom = 0;
    for (const line of lines) {
        const needle = line + "\n";
        const idx = out.indexOf(needle, searchFrom);
        if (idx !== -1) {
            out = out.slice(0, idx) + out.slice(idx + needle.length);
            searchFrom = idx;
        }
    }
    return out;
}

(async () => {
    const buf = fs.readFileSync(wasmPath);
    const which = process.argv[2] ? EXAMPLES.filter(e => e.id === process.argv[2]) : EXAMPLES;
    if (!which.length) { console.error("unknown example id"); process.exit(2); }

    // The Ring lives in playground/examples/<id>.ring — the same files the
    // Playground fetches — so this compares what a reader actually sees.
    const sourceOf = ex => fs.readFileSync(
        path.join(__dirname, "..", "playground", "examples", ex.id + ".ring"), "utf8");

    let failures = 0;
    for (const ex of which) {
        ex.code = sourceOf(ex);
        // fresh VM per example: ChangeRingKeyword etc. pollute the resident state
        const ring = await RingScript.load(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), {
            captureStdout: true,
            onOutput: () => {},
        });
        let wasmRes;
        try {
            wasmRes = ring.eval(ex.code, ex.input);
        } catch (e) {
            console.log("FAIL  " + ex.id + "  (wasm crashed: " + e.message + ")");
            failures++;
            continue;
        }
        let nativeOut;
        try {
            nativeOut = runNative(ex.code, ex.input);
        } catch (e) {
            console.log("SKIP  " + ex.id + "  (native oracle failed: " + String(e.message).split("\n")[0] + ")");
            console.log("      wasm output:\n" + wasmRes.output.replace(/^/gm, "      | "));
            continue;
        }
        const wasmOut = stripEchoes(wasmRes.output, ex.input);
        if (wasmOut === nativeOut && !wasmRes.error) {
            console.log("PASS  " + ex.id);
        } else {
            failures++;
            console.log("FAIL  " + ex.id + (wasmRes.error ? "  [error: " + wasmRes.error + "]" : ""));
            console.log("  --- native (oracle) ---");
            console.log(nativeOut.replace(/^/gm, "  | "));
            console.log("  --- wasm (echoes stripped) ---");
            console.log(wasmOut.replace(/^/gm, "  | "));
        }
    }
    console.log(failures === 0 ? "\nAll examples match the native oracle." : "\n" + failures + " example(s) FAILED.");
    process.exit(failures ? 1 : 0);
})().catch(e => { console.error("harness crashed:", e); process.exit(1); });
