/*
** RingScript Playground examples — the manifest.
**
** The Ring itself lives one file per example in playground/examples/,
** as ordinary .ring files you can run with ring.exe. This list only says
** which files exist, what to call them in the picker, and what a `give`
** would be answered with. The Playground fetches the file when you pick
** it; tests/examples-oracle.js reads the same files off disk.
*/
(function (global) {
    "use strict";

    const RING_EXAMPLES = [
        { id: "hello-world", title: "Hello World", input: "" },
        { id: "print-numbers", title: "Print Numbers", input: "" },
        { id: "say-hello", title: "Say Hello", input: "Mansour\n" },
        { id: "sum-two-numbers", title: "Sum two Numbers", input: "15\n4\n" },
        { id: "using-functions", title: "Using Functions", input: "" },
        { id: "using-objects", title: "Using Objects", input: "" },
        { id: "variable-scope", title: "Variable Scope", input: "" },
        { id: "using-lists", title: "Using Lists", input: "" },
        { id: "lists-as-hashtables", title: "Using Lists as HashTables", input: "" },
        { id: "exit-two-loops", title: "Exit from Two Loops", input: "" },
        { id: "using-evals", title: "Using Evals", input: "" },
        { id: "change-keywords-arabic", title: "Change Keywords (Arabic Syntax)", input: "25\nمنصور\n" },
        { id: "call-methods-braces", title: "Call Methods Using Braces", input: "" },
        { id: "brace-expr-eval", title: "Using BraceExprEval", input: "" },
        { id: "natural-commands", title: "Natural Commands", input: "" },
        { id: "main-menu", title: "Main Menu", input: "3\n5\n" },
        { id: "functional-map", title: "Functional: Anonymous Functions & Map", input: "" },
        { id: "first-class-functions", title: "First-class Functions", input: "" },
        { id: "equality-of-functions", title: "Equality of Functions", input: "" },
        { id: "operator-overloading", title: "Operator Overloading", input: "" },
        { id: "inheritance-super", title: "Inheritance & Super", input: "" },
        { id: "private-attributes", title: "Private Attributes & Methods", input: "" },
        { id: "packages", title: "Packages", input: "" },
        { id: "reflection", title: "Reflection & Meta-programming", input: "" },
    ];

    // Where an example's Ring source lives, relative to the Playground page.
    function exampleFile(id) { return "examples/" + id + ".ring"; }

    if (typeof module !== "undefined" && module.exports) {
        module.exports = RING_EXAMPLES;
        module.exports.exampleFile = exampleFile;
    }
    global.RING_EXAMPLES = RING_EXAMPLES;
    global.exampleFile = exampleFile;
})(typeof globalThis !== "undefined" ? globalThis : this);
