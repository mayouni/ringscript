/*
** Extract `.. code-block:: ring` snippets from the Ring documentation
** sources (the same content ring-lang.github.io/doc1.27 serves) into
** tests/doc-snippets/<chapter>-NN.ring, for the samples sweep:
**
**   node tests/extract-doc-snippets.js
**   node tests/samples-sweep.js --root=tests/doc-snippets --dirs=.
**
** Env: RING_HOME — the Ring installation whose documents/ folder is read
**      (auto-detected from the `ring` interpreter's location otherwise).
*/
const fs = require("fs");
const path = require("path");

const RING_HOME = require(path.join(__dirname, "ring-exe.js")).ringHome();
const SRC = path.join(RING_HOME, "documents", "build", "html", "_sources");
const OUT = path.join(__dirname, "doc-snippets");

// Pure-language chapters (GUI/network/db/tool chapters excluded by design)
const CHAPTERS = [
    "variables", "operators", "controlstructures", "controlstructures2",
    "controlstructures3", "functions", "fp", "lists", "strings", "oop",
    "scope", "scope2", "declarative", "natural", "syntaxflexibility",
    "mathfunc", "checkandconvert", "programstructure", "dateandtime",
    "getinput", "usingref", "metaprog", "getting_started",
];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let total = 0;
for (const ch of CHAPTERS) {
    const file = path.join(SRC, ch + ".txt");
    if (!fs.existsSync(file)) { console.log("missing chapter: " + ch); continue; }
    const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    const lines = text.split("\n");
    let n = 0;
    for (let i = 0; i < lines.length; i++) {
        if (!/^\.\.\s+code-block::\s+(ring|none)\s*$/.test(lines[i])) continue;
        // Heuristic: a code block that follows an "Output:" line is expected
        // output, not a program — skip it.
        let back = i - 1;
        while (back >= 0 && lines[back].trim() === "") back--;
        if (back >= 0 && /^Output\s*[:]?\s*$/i.test(lines[back].trim())) continue;
        // collect the indented block
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === "") j++;
        const indentMatch = (lines[j] || "").match(/^(\s+)/);
        if (!indentMatch) continue;
        const indent = indentMatch[1];
        const body = [];
        for (; j < lines.length; j++) {
            if (lines[j].trim() === "") { body.push(""); continue; }
            if (!lines[j].startsWith(indent)) break;
            body.push(lines[j].slice(indent.length));
        }
        while (body.length && body[body.length - 1] === "") body.pop();
        const code = body.join("\n") + "\n";
        // must look like a program, not a syntax fragment
        if (code.trim().length < 8) continue;
        n++;
        fs.writeFileSync(path.join(OUT, ch + "-" + String(n).padStart(2, "0") + ".ring"), code, "utf8");
    }
    total += n;
    console.log(ch + ": " + n + " snippets");
}
console.log("total: " + total + " -> " + OUT);
