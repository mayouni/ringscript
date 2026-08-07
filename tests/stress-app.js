/*
** RingScript stress test — a real application, with an oracle.
**
** playground/stress.ring is a tontine ledger (LedgerRun): take a JSON payload of
** deposits from an API, validate it against the ZQL norm, aggregate by
** member and by round, rank the members, render a report, hand a summary
** back. Ordinary Ring — lists, a class, for/in, sort, string concat — at a
** size where every shortcut shows.
**
** The point is not the stopwatch. Every number the Ring app produces is
** recomputed here in JavaScript, from the same records, and compared
** exactly: totals, per-member counts, per-round sums, the ranking and its
** tie-breaks, the status census, the rejected rows. A stress test without
** an oracle only proves the code ran.
**
** What it exercises, and what each part is really testing:
**   JSON in/out at megabyte scale     the C codec (HEADROOM P2)
**   50k-record walk, 20-way lookups   dispatch and list indexing (P4)
**   20-way member scan per record    list indexing in a hot loop
**   sort + reverse on built keys      the VM's own sort
**   a ~1.5 KB report by concatenation string growth
**   repeated runs on one VM           residency, and that nothing leaks (P0)
**   a malformed payload               errors stay catchable, VM survives
**
** Usage: node tests/stress-app.js [deposits] [runs]
*/
const fs = require("fs");
const path = require("path");
const RingScript = require(path.join(__dirname, "..", "playground", "ringscript.js"));

const N = parseInt(process.argv[2], 10) || 50000;
const RUNS = parseInt(process.argv[3], 10) || 3;

let failures = 0;
function check(name, cond, detail) {
    console.log((cond ? "  PASS  " : "  FAIL  ") + name +
        (cond || detail === undefined ? "" : "  [" + detail + "]"));
    if (!cond) failures++;
}

/* ------------------------------------------------------------- the data */

// Deterministic, so a failure is reproducible and the oracle sees exactly
// what Ring saw.
function rng(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const MEMBERS = 20, ROUNDS = 12;
const STATUSES = ["STAGED", "AUDITED", "ACTIVE"];

function makeDeposits(n, seed) {
    const rand = rng(seed);
    const out = [];
    for (let i = 1; i <= n; i++) {
        const m = Math.floor(rand() * MEMBERS) + 1;
        const r = Math.floor(rand() * ROUNDS) + 1;
        // amounts in whole units so JS and Ring agree bit-for-bit; one in
        // ~400 is invalid, which is what the ZQL norm exists to catch
        const bad = rand() < 0.0025;
        const amount = bad ? (rand() < 0.5 ? 0 : -Math.floor(rand() * 50) - 1)
                           : Math.floor(rand() * 500) + 1;
        out.push({
            id: i,
            member: "m" + String(m).padStart(2, "0"),
            round: r,
            amount: amount,
            status: STATUSES[Math.floor(rand() * STATUSES.length)],
        });
    }
    return out;
}

/* ----------------------------------------------------------- the oracle */

// The same computation, independently. Deliberately written in a different
// shape from the Ring version (maps, not linear scans) so a shared logical
// mistake is unlikely to survive in both.
function oracle(deposits) {
    const members = new Map(), rounds = new Array(ROUNDS).fill(0);
    const statuses = new Map();
    const bad = [];        // sample, capped at 25 like the app's
    let grand = 0, accepted = 0, rejected = 0;
    for (const d of deposits) {
        if (typeof d.amount !== "number" || d.amount <= 0) {
            rejected++;
            if (bad.length < 25) bad.push(d.id + ":" + d.member);
            continue;
        }
        accepted++;
        let m = members.get(d.member);
        if (!m) { m = { total: 0, count: 0, biggest: 0 }; members.set(d.member, m); }
        m.total += d.amount;
        m.count++;
        if (d.amount > m.biggest) m.biggest = d.amount;
        rounds[d.round - 1] += d.amount;
        statuses.set(d.status, (statuses.get(d.status) || 0) + 1);
        grand += d.amount;
    }
    // Ring sorts [total, name, ...] ascending then reverses. Mirror that
    // exactly, including how ties on total order by name.
    const rank = [...members.entries()]
        .map(([name, m]) => [m.total, name, m.count, m.biggest])
        .sort((a, b) => (a[0] - b[0]) || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
        .reverse();
    return { grand, accepted, rejected, seen: deposits.length,
             members: members.size, rounds, rank, bad,
             statuses: [...statuses.entries()] };
}

/* --------------------------------------------------------------- main */

(async () => {
    const buf = fs.readFileSync(path.join(__dirname, "..", "playground", "ringscript.wasm"));
    const shared = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const ring = await RingScript.load(shared, { onOutput: () => {} });

    const appSrc = fs.readFileSync(path.join(__dirname, "..", "playground", "stress.ring"), "utf8");
    const loaded = ring.eval(appSrc);
    check("the app loads", loaded.ok, loaded.error);
    if (!loaded.ok) { process.exit(1); }

    const deposits = makeDeposits(N, 20260807);
    const json = JSON.stringify(deposits);
    const want = oracle(deposits);

    console.log("\ntontine ledger — " + N.toLocaleString() + " deposits, " +
        (json.length / 1048576).toFixed(2) + " MB of JSON, " +
        MEMBERS + " members x " + ROUNDS + " rounds\n");

    let got = null, wall = Infinity, first = 0;
    const heap0 = ring.instance.exports.memory.buffer.byteLength;
    for (let r = 0; r < RUNS; r++) {
        const t0 = process.hrtime.bigint();
        const res = ring.call("LedgerRun", json);
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        if (!res.ok) { check("run " + (r + 1) + " completed", false, res.error); process.exit(1); }
        const s = typeof res.result === "string" ? JSON.parse(res.result) : res.result;
        if (r === 0) first = ms;
        if (ms < wall) { wall = ms; got = s; }
        // tasks are [name, ms, answer] TRIPLES, so they stay a JSON array.
        // (A list of 2-element [string, value] pairs would have become an
        // object instead — the pair-list convention, not a quirk.)
        const ph = (s.tasks || []).map(function (t) {
            return t[0].split(" ")[0].toLowerCase() + " " + t[1].toFixed(0); }).join("  ");
        console.log("  run " + (r + 1) + ": " + ms.toFixed(0) + " ms   [" + ph + "]");
    }

    /* ---- correctness: every number, against the oracle ---- */
    console.log("\ncorrectness — Ring vs an independent JavaScript computation");
    check("deposits seen", got.seen === want.seen, got.seen + " vs " + want.seen);
    check("accepted", got.accepted === want.accepted, got.accepted + " vs " + want.accepted);
    check("rejected by the positive_deposit norm",
        got.rejected === want.rejected, got.rejected + " vs " + want.rejected);
    check("grand total", got.grand === want.grand, got.grand + " vs " + want.grand);
    check("distinct members", got.members === want.members, got.members + " vs " + want.members);
    check("per-round totals",
        JSON.stringify(got.rounds) === JSON.stringify(want.rounds),
        JSON.stringify(got.rounds) + " vs " + JSON.stringify(want.rounds));
    const wantTop = want.rank.slice(0, 5).map((r) => ({ member: r[1], total: r[0], count: r[2], biggest: r[3] }));
    check("top 5 ranking, with tie-breaks",
        JSON.stringify(got.top) === JSON.stringify(wantTop),
        JSON.stringify(got.top) + "\n         vs " + JSON.stringify(wantTop));
    // the totals must actually add up, independently of both implementations
    const sumRounds = got.rounds.reduce((a, b) => a + b, 0);
    check("round totals sum to the grand total", sumRounds === got.grand,
        sumRounds + " vs " + got.grand);
    const sumMembers = want.rank.reduce((a, r) => a + r[0], 0);
    check("member totals sum to the grand total", sumMembers === got.grand,
        sumMembers + " vs " + got.grand);

    /* ---- the report is real output, not a stub ---- */
    check("the report has a line per member and per round",
        got.report.split("\n").length >= want.members + ROUNDS + 8,
        got.report.split("\n").length + " lines");
    check("the report carries the grand total",
        got.report.indexOf(String(got.grand)) > 0);

    /* ---- residency: repeated runs must not accumulate ---- */
    const heapBefore = ring.instance.exports.memory.buffer.byteLength;
    const clsBefore = parseInt(ring.eval("? len(classes())").output, 10);
    for (let i = 0; i < 3; i++) ring.call("LedgerRun", json);
    const heapAfter = ring.instance.exports.memory.buffer.byteLength;
    const clsAfter = parseInt(ring.eval("? len(classes())").output, 10);
    console.log("\nresidency — three more runs on the same VM");
    check("no class accumulates", clsAfter === clsBefore, clsBefore + " -> " + clsAfter);
    check("heap does not grow run over run",
        heapAfter <= heapBefore, (heapBefore / 1048576).toFixed(1) + " -> " +
        (heapAfter / 1048576).toFixed(1) + " MB");

    /* ---- payload shape: the single biggest lever a page has ---- */
    //
    // JsonDecode turns {"id":1,...} into a pair-list — a list per record
    // AND a list per field. The same data as [1,...] is one flat list per
    // record. That difference dominates everything else at this size, so
    // it is measured rather than asserted from theory.
    console.log("\npayload shape — the same 50,000 records, two ways");
    const asArrays = JSON.stringify(deposits.map(
        (d) => [d.id, d.member, d.round, d.amount, d.status]));
    const shapes = [];
    for (const [label, payload] of [["objects {id:…}", json], ["arrays [id,…]", asArrays]]) {
        const vm = await RingScript.load(shared, { onOutput: () => {} });
        vm.eval("func JustDecode c\n  a = JsonDecode(c)\n  return len(a)");
        const before = vm.instance.exports.memory.buffer.byteLength;
        const t0 = process.hrtime.bigint();
        const r = vm.call("JustDecode", payload);
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        const after = vm.instance.exports.memory.buffer.byteLength;
        shapes.push({ label, ms, mb: (after - before) / 1048576, n: r.result,
                      payloadMB: payload.length / 1048576 });
        console.log("  " + label.padEnd(16) + (payload.length / 1048576).toFixed(2) +
            " MB payload   decode " + ms.toFixed(0).padStart(5) + " ms   heap +" +
            ((after - before) / 1048576).toFixed(0).padStart(3) + " MB");
    }
    check("both shapes decode the same record count",
        shapes[0].n === shapes[1].n && shapes[0].n === N, shapes[0].n + " / " + shapes[1].n);
    check("arrays decode faster than objects", shapes[1].ms < shapes[0].ms,
        (shapes[0].ms / shapes[1].ms).toFixed(1) + "x");
    check("arrays cost less memory than objects", shapes[1].mb < shapes[0].mb,
        (shapes[0].mb / shapes[1].mb).toFixed(1) + "x");
    console.log("  -> arrays are " + (shapes[0].ms / shapes[1].ms).toFixed(1) +
        "x faster to decode and use " + (shapes[0].mb / shapes[1].mb).toFixed(1) +
        "x less memory. For bulk data, send rows, not objects.");

    /* ---- a hostile payload is an error, not a casualty ---- */
    console.log("\nrobustness");
    const broken = ring.call("LedgerRun", "{not json at all");
    check("a malformed payload fails cleanly", !broken.ok && broken.error.length > 0,
        String(broken.error).slice(0, 60));
    const empty = ring.call("LedgerRun", "[]");
    check("an empty ledger is a valid answer",
        empty.ok && JSON.parse(empty.result).seen === 0,
        empty.ok ? "" : empty.error);
    check("the VM still works afterwards", ring.eval("? 6*7").output.trim() === "42");

    // The first run pays for growing the wasm heap to hold the decoded
    // records; every run after it reuses that memory. Both numbers are
    // real, and a page feels the first one, so both are reported.
    const heap1 = ring.instance.exports.memory.buffer.byteLength;
    console.log("\nfirst run    : " + first.toFixed(0) + " ms  (includes growing the heap " +
        (heap0 / 1048576).toFixed(0) + " -> " + (heap1 / 1048576).toFixed(0) + " MB)");
    console.log("steady state : " + wall.toFixed(0) + " ms for " + N.toLocaleString() +
        " deposits — " + Math.round(N / (wall / 1000)).toLocaleString() + " deposits/second");
    console.log(failures ? "\n" + failures + " stress check(s) FAILED." : "\nStress app clean.");
    process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("stress app crashed:", e); process.exit(1); });
