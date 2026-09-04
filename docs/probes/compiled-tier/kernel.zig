// Throwaway probe kernel — the "compiled tier" half of the Numba question.
//
// Two exports, mirroring two Ring functions exactly:
//   loopKernel(n)          pure arithmetic, no data  -> the dispatch ceiling
//   sumWeighted(len)       walk/filter/weight/accum  -> the ledger shape
//
// The data lives in a static buffer the host fills, so this measures
// COMPUTE ONLY; the cost of getting Ring's list into that buffer is
// measured separately on the host side. That split is the whole point.

var buf: [1_000_000]f64 = undefined;

export fn bufPtr() [*]f64 {
    return &buf;
}

export fn loopKernel(n: i32) f64 {
    var s: f64 = 0;
    var i: i32 = 1;
    while (i <= n) : (i += 1) {
        const fi: f64 = @floatFromInt(i);
        s = s + fi * 2 - 1;
    }
    return s;
}

export fn sumWeighted(len: usize) f64 {
    var s: f64 = 0;
    var i: usize = 0;
    while (i < len) : (i += 1) {
        const v = buf[i];
        if (v > 100) s = s + v * 3;
    }
    return s;
}
