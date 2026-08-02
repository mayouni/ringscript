/*
** Locating the native Ring interpreter used as the test oracle, on any
** platform. Order of resolution:
**   1. $RING_EXE            — explicit path to the interpreter
**   2. $RING_HOME/bin/ring[.exe]
**   3. `ring` on PATH       — the normal case on macOS/Linux installs
**   4. a couple of conventional install locations (last resort)
*/
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const isWin = process.platform === "win32";
const exeName = isWin ? "ring.exe" : "ring";

function fromPath() {
    try {
        const out = execFileSync(isWin ? "where" : "which", [exeName], { stdio: ["ignore", "pipe", "ignore"] });
        const first = out.toString().split(/\r?\n/).find(Boolean);
        return first && fs.existsSync(first) ? first : null;
    } catch (e) {
        return null;
    }
}

function ringHome() {
    if (process.env.RING_HOME) return process.env.RING_HOME;
    const guesses = isWin
        ? ["C:\\ring", "D:\\ring127", "C:\\Ring126"]
        : ["/usr/local/ring", "/opt/ring", path.join(process.env.HOME || "", "ring")];
    return guesses.find(d => fs.existsSync(path.join(d, "bin", exeName))) || guesses[0];
}

function ringExe() {
    if (process.env.RING_EXE) return process.env.RING_EXE;
    const home = process.env.RING_HOME;
    if (home) {
        const p = path.join(home, "bin", exeName);
        if (fs.existsSync(p)) return p;
    }
    return fromPath() || path.join(ringHome(), "bin", exeName);
}

module.exports = { ringExe, ringHome, exeName, isWin };
