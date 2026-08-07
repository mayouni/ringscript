/*
** RingScript phase gates (REPAIR_PLAN.md §4) — runnable verification.
** Usage: node tests/gates.js [phase]   (no arg = run all available)
** Exits nonzero if any gate fails.
*/
const fs = require("fs");
const path = require("path");
const RingScript = require(path.join(__dirname, "..", "playground", "ringscript.js"));

const wasmPath = path.join(__dirname, "..", "playground", "ringscript.wasm");

let failures = 0;
function check(name, cond, detail) {
    console.log((cond ? "  PASS  " : "  FAIL  ") + name + (cond || detail === undefined ? "" : "  [" + detail + "]"));
    if (!cond) failures++;
}

// One buffer for every gate VM: the loader caches the compiled Module by
// buffer identity, so the suite compiles the wasm once (HEADROOM_PLAN P1).
const gateBuf = fs.readFileSync(wasmPath);
const sharedBytes = gateBuf.buffer.slice(gateBuf.byteOffset, gateBuf.byteOffset + gateBuf.byteLength);

async function newVM(opts) {
    return RingScript.load(sharedBytes, opts || { onOutput: () => {} });
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

        // The resident VM must not accumulate definitions per evaluation.
        // Every eval used to append a uniquely-named terminator class, so the
        // class list grew by one each time — invisible at 1,000 evals, fatal
        // at 20,000 (the heap reached 936 MB on ordinary page-style code).
        // A declaration-free eval must now add nothing at all.
        const classCount = () =>
            parseInt(ring.eval("see len(classes())").output, 10);
        const clsBefore = classCount();
        for (let i = 0; i < 3000; i++) ring.eval("q = 1 + 2");
        const clsAfter = classCount();
        check("no class leaked per eval (3000 evals)", clsAfter - clsBefore <= 2,
            clsBefore + " -> " + clsAfter + " classes");

        // ...but code that opens a region still gets its terminator, or a
        // trailing class/func would be closed at the wrong place. Attribute
        // names are deliberately odd: this VM already holds globals a, b, c
        // from the error tests above, and a global of the same name shadows
        // an attribute (Ring's documented scope rule, not a bug).
        const withClass = ring.eval("class LeakGate gkOne gkTwo");
        const madeOne = ring.eval("oGate = new LeakGate  oGate.gkOne = 5  see oGate.gkOne");
        check("a trailing class still works", withClass.ok && madeOne.output === "5",
            JSON.stringify(madeOne));

        // Every pointer the loader receives is a wasm i32, so past 2 GB it
        // arrives NEGATIVE. Unsigned handling is what keeps eval() readable
        // and the page alive once the heap crosses that line; the loader used
        // to throw RangeError there and take the page with it.
        const big = 0x8000000B | 0;                    // a >2 GB pointer as i32
        check("a >2GB pointer reads as unsigned", (big >>> 0) === 2147483659,
            String(big >>> 0));
        const stillResult = ring.eval("$$$ not ring $$$");
        check("a failed eval still returns a result",
            !stillResult.ok && typeof stillResult.error === "string",
            JSON.stringify(stillResult).slice(0, 80));
    },

    async p3() {
        console.log("P3 — embedded stzZql payload");
        const ring = await newVM();
        const r = ring.eval('load "ringlib/stzzql_smoke.ring"');
        check("smoke test loads via embedded map", r.ok, r.error);
        check("10 passed, 0 failed", r.output.includes("10 passed, 0 failed"), r.output.slice(-80));
        // load resolved a nested relative load too (smoke loads stzZql.ring)
        const q = ring.eval('o2 = StzZqlQ("DEFINE ENTITY m (id: uuid)") see o2.CountEntities()');
        check("stzZql stays resident after load", q.ok && q.output === "1", JSON.stringify(q));

        // Describe() must read back in the grammar's own vocabulary — bare
        // names, and every declaration kind including landing zones.
        const d = ring.eval(
            'o3 = StzZqlQ("DEFINE FLOW collect (STEP 1: R -> { ACTOR: a })' +
            ' DEFINE LANDING_ZONE imp AS JSON INTO collect")\n' +
            'see o3.Describe()');
        check("Describe lists flows and zones",
            d.ok && d.output.includes("flow collect") && d.output.includes("zone imp (JSON into collect)"),
            JSON.stringify(d));
        // A sigil is a colon that opens a name. `link:` keeps its colon —
        // that one is a label, so match ":" + letter rather than any colon.
        check("Describe emits no sigils", d.ok && !/:[A-Za-z_]/.test(d.output), JSON.stringify(d.output));
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
            '  o = StzZqlQ("DEFINE FLOW collect (STEP 1: RECORD -> { ACTOR: collector, VALIDATE: member != " + cQ + cQ + ", ON_FAIL: REJECT " + cQ + "NO_MEMBER" + cQ + " })")\n' +
            '  return o.RunFlow("collect", aData)');
        const flow = ring.call("RunCollect", { member: "Aminata", amount: 5000 });
        check("stzZql flow result returns as JSON", flow.ok && flow.result.status === "complete", JSON.stringify(flow.result));
        const rejected = ring.call("RunCollect", { member: "", amount: 5000 });
        check("flow rejection visible in JSON", rejected.ok && rejected.result.status === "failed" && rejected.result.actionarg === "NO_MEMBER", JSON.stringify(rejected.result));

        // Platform() is for capabilities of the deployment target — the
        // stz.platform contract in StzWeb — so `notify` is the right verb.
        let seen = null;
        ring.on("notify", p => { seen = p; return { ack: 1 }; });
        const js = ring.eval('a = Platform("notify", [ :msg = "hi" ]) see a[:ack]');
        check("jscall reaches JS handler", seen && seen.msg === "hi", JSON.stringify(seen));
        check("JS reply returns to Ring", js.ok && js.output === "1", JSON.stringify(js));

        // Page() is the same seam for the document itself; both must reach
        // a handler, or one of the two vocabularies is quietly broken.
        let sawPage = null;
        ring.on("settext", p => { sawPage = p; return 1; });
        const pg = ring.eval('a = Page("settext", [ :id = "hello", :text = "Ahlan" ]) see a');
        check("Page reaches the same seam", sawPage && sawPage.text === "Ahlan", JSON.stringify(sawPage));
        check("Page returns the handler value", pg.ok && pg.output === "1", JSON.stringify(pg));

        const bad = ring.call("NoSuchFunction", {});
        check("unknown function traps cleanly", !bad.ok && bad.error.includes("without definition"), bad.error);
    },

    // The VM is one resident state and cannot run inside itself. The
    // reachable way to try is a jscall or onGive handler calling Ring back
    // while Ring is still running. Unguarded, that discarded the rest of the
    // outer program, swapped its output and error for the inner one's, and
    // handed rs_call the wrong return value — all reporting ok = true.
    async reentry() {
        console.log("\nReentrancy — the page calling Ring back while Ring runs");

        // 1. An eval attempted from a jscall handler is refused, and — the
        //    part that matters — the OUTER program is unharmed.
        const ring = await newVM();
        let innerErr = null;
        ring.on("gate_probe", () => { innerErr = ring.eval('see "INNER"'); return "ok"; });
        const outer = ring.eval('nAfter = 0\nsee "A"\njscall("gate_probe", "")\nnAfter = 22\nsee "B"');
        check("outer eval keeps its own output across a callback",
            outer.ok && outer.output === "AB", JSON.stringify(outer.output));
        check("outer eval runs to completion across a callback",
            ring.eval("? nAfter").output.trim() === "22", ring.eval("? nAfter").output.trim());
        check("the re-entrant eval is refused, not silently run",
            innerErr && !innerErr.ok && innerErr.code === -3 &&
            /already running/.test(innerErr.error), innerErr && innerErr.error);

        // 2. An error raised AFTER the callback must still be reported. This
        //    was the worst symptom: a failing program reported success.
        const ring2 = await newVM();
        ring2.on("gate_p2", () => { ring2.eval('see "x"'); return "ok"; });
        const errOuter = ring2.eval('jscall("gate_p2", "")\nno_such_function_here()');
        check("an error after the callback is still the outer's error",
            !errOuter.ok && /no_such_function_here/.test(errOuter.error), errOuter.error);

        // 3. ring.call must return ITS value, not the handler's.
        const ring3 = await newVM();
        ring3.eval("func GateOuter p\n  jscall('gate_p3', '')\n  return 'OUTER'\n" +
                   "func GateInner p\n  return 'INNER'");
        let innerCall = null;
        ring3.on("gate_p3", () => { innerCall = ring3.call("GateInner", 1); return "handler"; });
        const called = ring3.call("GateOuter", 1);
        check("ring.call returns its own result, not the handler's",
            called.ok && called.result === "OUTER", JSON.stringify(called.result));
        check("the re-entrant call is refused", innerCall && !innerCall.ok &&
            /already running/.test(innerCall.error), innerCall && innerCall.error);

        // 4. onGive is the other way in.
        let ring4, giveInner = null;
        ring4 = await newVM({ onOutput: () => {},
            onGive: () => { giveInner = ring4.eval('see "INNER"'); return "Bob"; } });
        const giveOuter = ring4.eval('see "before "\ngive n\nsee "got " + n');
        check("onGive re-entry is refused and the outer survives",
            giveOuter.ok && giveOuter.output === "before Bob\ngot Bob" &&
            giveInner && !giveInner.ok, JSON.stringify(giveOuter.output));

        // 5. reset() would delete the state the running VM stands on.
        const ring5 = await newVM();
        let resetRc = null;
        ring5.on("gate_p5", () => { resetRc = ring5.reset(); return "ok"; });
        const survived = ring5.eval('nLived = 0\njscall("gate_p5", "")\nnLived = 1\nsee "alive"');
        check("reset() from inside a handler is refused", resetRc === -3, String(resetRc));
        check("the VM survives a refused reset", survived.ok && survived.output === "alive",
            JSON.stringify(survived.output));

        // 6. busy() is what a handler asks to find out why it must defer.
        const ring6 = await newVM();
        let busyInside = null;
        ring6.on("gate_p6", () => { busyInside = ring6.busy(); return "ok"; });
        check("busy() is false at rest", ring6.busy() === false);
        ring6.eval('jscall("gate_p6", "")');
        check("busy() is true inside a handler", busyInside === true, String(busyInside));
        check("busy() is false again afterwards", ring6.busy() === false);

        // 7. A wasm TRAP unwinds out of rs_eval without running its defer.
        //    If the guard survived that, every later eval would be refused for
        //    the life of the page — a fresh way to brick exactly the page P1
        //    was about. The loader clears it in a finally.
        const ring7 = await newVM();
        const trapped = ring7.eval("[".repeat(200000));
        check("a trapping eval returns a result", !trapped.ok, String(trapped.code));
        check("a trap does not leave the guard standing", ring7.busy() === false);
        check("the VM still evaluates after a trap",
            ring7.eval("? 6*7").output.trim() === "42");

        // 8. And the workaround the error message recommends must actually
        //    work — deferring past the handler's return.
        const ring8 = await newVM();
        let deferred = null;
        ring8.eval("func GateLater p\n  return 'ran later'");
        ring8.on("gate_p8", () => {
            queueMicrotask(() => { deferred = ring8.call("GateLater", 1); });
            return "ok";
        });
        ring8.eval('jscall("gate_p8", "")');
        await new Promise((r) => setTimeout(r, 0));
        check("the documented deferral (queueMicrotask) works",
            deferred && deferred.ok && deferred.result === "ran later",
            JSON.stringify(deferred));
    },

    // The JSON codec is the only thing that touches data a page did not
    // write — a server response handed to ring.call. It is therefore the
    // one place where "slow" is a security property, not a comfort.
    async json() {
        console.log("\nJSON — the bridge's only untrusted input");
        const ring = await newVM();
        const out = (c) => { const r = ring.eval(c); return r.ok ? r.output.trim() : "ERR " + r.error; };
        ring.eval("func JsonEcho p\n  return p");

        // Reading a big string one byte at a time is O(n^2) in Ring, because
        // substr(cBig, i, 1) costs len(cBig). A 1 MB payload used to take
        // 260 SECONDS — a page frozen by the size of a server response. The
        // budget is deliberately loose (measured ~1s); it is here to catch a
        // return to quadratic, which would blow past it by orders of magnitude.
        const big = "A".repeat(1024 * 1024);
        const t0 = Date.now();
        const round = ring.call("JsonEcho", { s: big });
        const ms = Date.now() - t0;
        check("1 MB round trip completes in seconds, not minutes", ms < 15000, ms + " ms");
        check("1 MB round trip is byte-exact",
            round.ok && round.result && round.result.s === big,
            round.ok ? String(round.result && round.result.s && round.result.s.length) : round.error);

        // decimals() is global VM state. Encoding a number used to reset it
        // to a hardcoded 2 — and JsonEncode runs on the return of every call.
        check("JsonEncode leaves decimals() alone",
            out("decimals(6)  cJ = JsonEncode([1.5])  ? 1/3") === "0.333333",
            out("decimals(6)  cJ = JsonEncode([1.5])  ? 1/3"));
        ring.eval("decimals(2)");
        check("numbers still encode as before", out("? JsonEncode([1.5, 2, 0.125])") === "[1.5,2,0.125]",
            out("? JsonEncode([1.5, 2, 0.125])"));

        // Round trips that exercise every branch of the escaper.
        const shapes = {
            utf8: { a: "café ✓ 日本 🎵" },
            escapes: { a: '"' + "\\" + "\n\r\t\b\f" },
            controls: { a: " " },
            empty: { a: "" },
            nested: { a: { b: { c: [1, 2, { d: "x" }] } } },
            numbers: { a: [0, -1, 1.5, 1e10, 1e-7, 0.1] },
            escapeHeavy: { a: ('"' + "\\" + "\n").repeat(20000) },
            unicodeHeavy: { a: "日本語".repeat(20000) },
        };
        let allMatch = true, firstBad = "";
        for (const [name, val] of Object.entries(shapes)) {
            const r = ring.call("JsonEcho", val);
            if (!r.ok || JSON.stringify(r.result) !== JSON.stringify(val)) {
                allMatch = false; if (!firstBad) firstBad = name;
            }
        }
        check("hostile shapes round trip byte-exact", allMatch, firstBad);

        // Malformed input reaches the codec through a raw jscall reply, which
        // no JSON.stringify has vetted. Every case must raise, never accept.
        const malformed = ['{', '[1,', '{"a"}', '{"a":}', '[1 2]', 'tru', '{"a":1,}', ''];
        let allRaised = true, accepted = "";
        for (const j of malformed) {
            const r = ring.eval("try  vX = JsonDecode('" + j.split("'").join("''") +
                                "')  ? \"ACCEPTED\"  catch  ? \"raised\"  done");
            if (!r.ok || r.output.trim() !== "raised") { allRaised = false; accepted = accepted || j; }
        }
        check("malformed JSON always raises, never accepts", allRaised, JSON.stringify(accepted));

        // Deep nesting recurses, and recursion is bounded by Ring's own stack
        // check. The requirement is not that it succeeds — it is that it
        // fails as a catchable Ring error and the VM lives.
        const deep = ring.eval('cJ = ""\nfor i = 1 to 5000 cJ += "[" next\n' +
            'for i = 1 to 5000 cJ += "]" next\n' +
            'try  aX = JsonDecode(cJ)  ? "decoded"  catch  ? "raised"  done');
        check("hostile nesting raises cleanly instead of crashing",
            deep.ok && deep.output.trim() === "raised", JSON.stringify(deep.output));
        check("VM survives the whole JSON gauntlet", out("? 6*7") === "42");

        // Since HEADROOM_PLAN P2 the shipped codec is C (src/rs_json.c);
        // ringlib/json.ring stays as the reference it is held BYTE-IDENTICAL
        // to. This gate loads the reference under renamed entry points and
        // compares outputs and error texts, so the two cannot drift apart.
        const fs2 = require("fs");
        const pureSrc = fs2.readFileSync(path.join(__dirname, "..", "src", "ringlib", "json.ring"), "utf8")
            .replace("func JsonEncode v", "func PureJsonEncode v")
            .replace("func JsonDecode cJson", "func PureJsonDecode cJson");
        const refVM = await newVM();
        check("the pure reference still loads", refVM.eval(pureSrc).ok);
        refVM.eval(
            "func DiffOne cJson\n" +
            '  cPerr = ""  cCerr = ""  cPval = ""  cCval = ""\n' +
            "  try  cPval = PureJsonEncode(PureJsonDecode(cJson))  catch  cPerr = cCatchError  done\n" +
            "  try  cCval = PureJsonEncode(JsonDecode(cJson))      catch  cCerr = cCatchError  done\n" +
            '  if cPerr != cCerr  return "ERR P<" + cPerr + "> C<" + cCerr + ">"  ok\n' +
            '  if cPval != cCval  return "VAL"  ok\n' +
            '  return "SAME"');
        const diffCases = [
            '[1.5,{"a":"caf\\u00e9"},null,true,[0.1,1e-7,-0,9007199254740991]]',
            '"a\\nb\\t\\"c\\\\d\\u0000\\u65e5"',
            '{', '{"a"}', 'tru', '"ab\\q"', '[1e999]', '[+]', '[--1]', '[.5]',
        ];
        let diffBad = "";
        for (const cse of diffCases) {
            const q = refVM.eval('? DiffOne("' + cse.split('"').join('" + char(34) + "') + '")');
            if (!q.ok || q.output.trim() !== "SAME") { diffBad = cse + " -> " + (q.output || q.error); break; }
        }
        check("C codec is byte-identical to the pure reference", diffBad === "", diffBad.slice(0, 100));
    },

    async io() {
        console.log("IO — give input, object printing, auto-main (examples challenge)");
        const ring = await newVM();
        // NOTE: the object test runs BEFORE the give tests on this VM.
        // `give x` creates a global x, and a global sharing an attribute's
        // name prevents that attribute from being defined — DOCUMENTED Ring
        // behavior (Scope Rules > "Conflict between Global Variables and
        // Class Attributes"), reproduced identically on native ring.exe.
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

        // The stat() family must agree with fopen about what exists. Ring's
        // fexists/getfilesize/getpathtype never call fopen — file_e.c reaches
        // for stat() directly — so before the rs_stat redirect they answered
        // "no such file" for embedded files read() reads happily, and the
        // idiomatic `if fexists(f) ... read(f)` guard skipped them.
        const ring3 = await newVM();
        const ask = (c) => { const r = ring3.eval(c); return r.ok ? r.output.trim() : "ERR " + r.error; };
        check("fexists() sees an embedded file",
            ask('? fexists("ringlib/json.ring")') === "1", ask('? fexists("ringlib/json.ring")'));
        const sizeOf = ask('? getfilesize("ringlib/json.ring")');
        check("getfilesize() agrees with read()",
            sizeOf === ask('? len(read("ringlib/json.ring"))') && +sizeOf > 0, sizeOf);
        check("getpathtype() calls it a file", ask('? getpathtype("ringlib/json.ring")') === "1",
            ask('? getpathtype("ringlib/json.ring")'));
        check("the fexists-then-read guard runs its body",
            ask('if fexists("ringlib/json.ring") see len(read("ringlib/json.ring")) ok') === sizeOf);
        // ...and still tells the truth about what is NOT there. There is no
        // filesystem, so directories genuinely do not exist.
        check("fexists() is false for a missing file", ask('? fexists("no-such-file.ring")') === "0");
        check("direxists() stays false", ask('? direxists("ringlib")') === "0");
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
