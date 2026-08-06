/*
** RingScript WASI shim tests — the hand-written host surface.
**
** playground/ringscript.js implements ~24 WASI imports by hand. It is the
** highest-risk code in the project per line, because a mistake there is
** silent: the VM keeps running and simply reports the wrong thing. Both
** defects found in it so far were found by accident —
**
**   · clock_time_get declared with 4 parameters instead of 3. Its i64
**     `precision` argument arrives as ONE BigInt, so the extra parameter
**     shifted timePtr and the time was written to the wrong address;
**     clock() and time() froze at stale values.
**   · CLOCK_REALTIME returned UTC. wasi-libc has no timezone database, so
**     the VM's localtime() left it alone and every Ring program in a browser
**     reported the wrong hour.
**
** Neither would have been caught by any other suite: both produce plausible
** output. These tests assert against the host's own clock, encoding and
** ordering rather than against the runtime's opinion of itself.
**
** Usage: node tests/wasi.js
*/
const fs = require("fs");
const path = require("path");
const RingScript = require(path.join(__dirname, "..", "playground", "ringscript.js"));

let failures = 0;
function check(name, cond, detail) {
    console.log((cond ? "  PASS  " : "  FAIL  ") + name +
        (cond || detail === undefined ? "" : "  [" + detail + "]"));
    if (!cond) failures++;
}
const pad2 = (n) => String(n).padStart(2, "0");

(async () => {
    const buf = fs.readFileSync(path.join(__dirname, "..", "playground", "ringscript.wasm"));
    const bytes = () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const newVM = (opts) => RingScript.load(bytes(), opts || { onOutput: () => {} });

    const ring = await newVM();
    const out = (code) => { const r = ring.eval(code); return r.ok ? r.output.trim() : "ERR " + r.error; };

    // ---------------------------------------------------- clock_time_get
    console.log("clock_time_get — the wall clock and the monotonic clock");

    const sys = new Date();
    const ringTime = out("? time()");
    const ringDate = out("? date()");

    const hhmmss = /^(\d{2}):(\d{2}):(\d{2})$/.exec(ringTime);
    check("time() has the shape HH:MM:SS", !!hhmmss, ringTime);
    if (hhmmss) {
        const secs = (s) => (+s[1]) * 3600 + (+s[2]) * 60 + (+s[3]);
        const drift = Math.abs(secs(hhmmss) -
            (sys.getHours() * 3600 + sys.getMinutes() * 60 + sys.getSeconds()));
        // LOCAL time, not UTC. A timezone offset shows up here as a whole
        // number of hours or half-hours; anything over 5s is a real error.
        check("time() is the host's LOCAL time", drift <= 5,
            "ring " + ringTime + " vs system " +
            pad2(sys.getHours()) + ":" + pad2(sys.getMinutes()) + ":" + pad2(sys.getSeconds()) +
            "  (" + drift + "s apart)");
    }
    check("date() is the host's LOCAL date",
        ringDate === pad2(sys.getDate()) + "/" + pad2(sys.getMonth() + 1) + "/" + sys.getFullYear(),
        "ring " + ringDate);

    // A wrong arity would freeze these at a constant, which is exactly how
    // the original bug presented.
    const c1 = parseFloat(out("? clock()"));
    let spin = 0; for (let i = 0; i < 3e6; i++) spin += i;      // burn a little time
    const c2 = parseFloat(out("? clock()"));
    check("clock() advances (not frozen at a stale value)", c2 > c1,
        c1 + " -> " + c2 + (spin ? "" : ""));
    let monotonic = true, prev = -Infinity;
    for (let i = 0; i < 25; i++) {
        const v = parseFloat(out("? clock()"));
        if (v < prev) monotonic = false;
        prev = v;
    }
    check("clock() never runs backwards", monotonic);

    // ---------------------------------------------------------- random_get
    console.log("\nrandom_get");
    const vals = [];
    for (let i = 0; i < 60; i++) vals.push(out("? random(1000)"));
    check("random() stays within range",
        vals.every((v) => +v >= 0 && +v <= 1000), vals.slice(0, 6).join(","));
    check("random() varies", new Set(vals).size > 20,
        new Set(vals).size + " distinct of 60");
    // Ring's random() is unseeded — native ring.exe repeats the same sequence
    // on every run too. We match that BEHAVIOUR; the values differ because
    // the C library differs, which is why the sweep treats such programs as
    // nondeterministic. Asserted so a future change to seeding is noticed.
    const seqA = (await newVM()).eval("for i=1 to 5 ? random(1000) next").output;
    const seqB = (await newVM()).eval("for i=1 to 5 ? random(1000) next").output;
    check("random() is unseeded, as in native Ring", seqA === seqB,
        JSON.stringify(seqA.trim().replace(/\n/g, ",")));

    // ------------------------------------------------------------- fd_write
    console.log("\nfd_write — output, encoding and ordering");

    const cap = await newVM({ onOutput: () => {}, captureStdout: true });

    // Both `see` and `print` are Ring-level and travel the ringvm_see hook.
    // What actually reaches fd_write is the VM's OWN printer — the C-level
    // messages it emits for what it handles itself, such as a failed load.
    // The distinction matters: testing fd_write with print() tests nothing.
    const mixed = cap.eval('see "A" + nl  print("B" + nl)  see "C" + nl  print("D" + nl)');
    check("see and print stay in program order",
        mixed.ok && mixed.output === "A\nB\nC\nD\n", JSON.stringify(mixed.output));

    // With captureStdout the C-level text re-enters the wasm so it lands in
    // the buffer at the right position instead of being appended after
    // everything else. Position is the entire point of that mechanism.
    // The failing load goes inside a nested eval, so it happens at RUNTIME.
    // A bare `load` fails while compiling, before any `see` has run, and
    // would prove nothing about ordering.
    const woven = cap.eval(
        'see "before" + nl\n' +
        'try  eval(\'load "no-such-file.ring"\')  catch  done\n' +
        'see "after" + nl');
    const iBefore = woven.output.indexOf("before");
    const iErr = woven.output.indexOf("E9");
    const iAfter = woven.output.indexOf("after");
    check("C-level output lands in position, not appended",
        iBefore >= 0 && iErr > iBefore && iAfter > iErr,
        JSON.stringify(woven.output.slice(0, 110)));

    // A non-ASCII filename sends multi-byte UTF-8 through fd_write itself,
    // which decodes per iovec — the place a split sequence would corrupt.
    const uniPath = cap.eval('load "日本語-café.ring"');
    check("fd_write keeps multi-byte UTF-8 intact",
        uniPath.output.includes("日本語-café"), JSON.stringify(uniPath.output.slice(0, 80)));

    // Multi-byte UTF-8 must survive the trip. fd_write decodes per iovec, so
    // a sequence split across buffers would come back as replacement chars.
    const uni = "café ← → ✓ 日本語 𝄞 emoji 🎵";
    const seeU = cap.eval('see "' + uni + '" + nl');
    check("see keeps multi-byte UTF-8 intact", seeU.output === uni + "\n",
        JSON.stringify(seeU.output));
    const printU = cap.eval('print("' + uni + '" + nl)');
    check("print keeps multi-byte UTF-8 intact", printU.output === uni + "\n",
        JSON.stringify(printU.output));

    // A long non-ASCII run, to cross whatever buffer boundaries exist.
    const longU = cap.eval('c = ""  for i = 1 to 3000 c += "日" next  print(c)');
    check("3,000 multi-byte chars survive print",
        longU.ok && longU.output.length === 3000 &&
        longU.output === "日".repeat(3000), longU.output.length + " chars");

    // Bytes that are not valid UTF-8 must not crash the decoder.
    const rawBytes = cap.eval("print(char(200) + char(201) + char(0) + char(255))");
    check("invalid UTF-8 bytes do not crash the decoder", rawBytes.ok,
        rawBytes.error || JSON.stringify(rawBytes.output));

    // Without captureStdout the same C-level text goes to the onOutput
    // callback instead — the mode a host uses to stream output to a terminal.
    let piped = "";
    const pipe = await newVM({ onOutput: (t) => { piped += t; } });
    pipe.eval('load "no-such-file.ring"');
    check("onOutput receives C-level output", piped.includes("E9"),
        JSON.stringify(piped.slice(0, 70)));

    let pipedU = "";
    const pipeU = await newVM({ onOutput: (t) => { pipedU += t; } });
    pipeU.eval('load "日本語-café.ring"');
    check("onOutput keeps multi-byte UTF-8 intact", pipedU.includes("日本語-café"),
        JSON.stringify(pipedU.slice(0, 70)));

    // -------------------------------------------------------------- fd_read
    console.log("\nfd_read, environ, args, and the unimplemented calls");
    // stdin is EOF: `give` with nothing queued must fail cleanly, not hang.
    const give = ring.eval("give sNothing");
    check("give with no input fails cleanly (no hang)",
        !give.ok && /input/i.test(give.error), give.error.slice(0, 60));

    // environ_sizes_get / args_sizes_get report zero, so these are empty.
    check("sysargv is an empty list", out("? len(sysargv)") === "0", out("? len(sysargv)"));

    // Filesystem calls land on rs_fopen or the ENOSYS fallback. Either way a
    // Ring program must get a catchable error, never a crash.
    const write = ring.eval('write("nope.txt", "x")');
    check("write() fails as a Ring error", !write.ok && /R35|create|open/i.test(write.error),
        write.error.slice(0, 60));
    const rename = ring.eval('rename("a.txt", "b.txt")');
    check("rename() fails without crashing", typeof rename.ok === "boolean",
        (rename.error || "ok").slice(0, 60));

    // And the VM is still healthy after all of that.
    check("VM healthy after the whole suite", out("? 6*7") === "42");

    console.log(failures ? "\n" + failures + " WASI check(s) FAILED." : "\nWASI shim clean.");
    process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("wasi suite crashed:", e); process.exit(1); });
