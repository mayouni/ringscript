/*
** code.js — every code block on the site rendered the way the Playground
** renders code: numbered lines, the same font, and Ring syntax coloured
** with the Playground's own highlighter.
**
** Two jobs, both automatic:
**
**   · static blocks — every multi-line <pre> in an article gets a gutter.
**     Consistency is the point: numbering some blocks and not others reads
**     as a bug, so the gutter is the default and only the syntax COLOURING
**     is conditional, since colouring a shell command as Ring would be
**     worse than leaving it plain. The text stays real text, so selecting,
**     copying and find-in-page all still work.
**
**   · the live runner — its <textarea> becomes the Playground's editor
**     (gutter, highlighted layer, current-line band) via RingHighlight.
**
** Loads after ring-highlight.js. Without either script the page degrades to
** a plain <pre>, which is what it was before.
*/
(function () {
    "use strict";

    /* Blocks that are certainly NOT Ring. Everything else is offered to the
       highlighter, which leaves unknown words alone anyway — the cost of a
       false positive is a word in the wrong colour, of a false negative a
       page of grey. */
    var NOT_RING = [
        /^\s*[$#]\s/,                        /* a shell prompt              */
        /^\s*(zig|npm|node|grep|curl|python|git|cd|ring|sed|awk|chmod)\s/,
        /^\s*</,                             /* HTML or XML                 */
        /^\s*"-D/,                           /* a compiler flag list        */
        /^\s*[┌│└├─╭╰]/                      /* an ASCII diagram            */
    ];

    function looksLikeRing(text) {
        for (var i = 0; i < NOT_RING.length; i++) {
            if (NOT_RING[i].test(text)) return false;
        }
        return true;
    }

    function gutterFor(count, doc) {
        var g = doc.createElement("div");
        g.className = "rh-gutter";
        g.setAttribute("aria-hidden", "true");
        var html = "";
        for (var i = 1; i <= count; i++) html += "<div>" + i + "</div>";
        g.innerHTML = html;
        return g;
    }

    function decorate(pre) {
        var doc = pre.ownerDocument;
        var codeEl = pre.querySelector("code") || pre;
        var text = codeEl.textContent.replace(/\n+$/, "");
        var count = text.split("\n").length;
        if (count < 2) return;              /* a one-liner needs no line 1 */

        if (looksLikeRing(text)) {
            codeEl.innerHTML = window.RingHighlight.highlight(text);
        }
        pre.classList.add("rh-static");

        var shell = doc.createElement("div");
        shell.className = "rh-shell rh-readonly";
        pre.parentNode.insertBefore(shell, pre);
        shell.appendChild(gutterFor(count, doc));
        shell.appendChild(pre);
        /* the numbers must not drift when the code scrolls */
        pre.addEventListener("scroll", function () {
            shell.firstChild.scrollTop = pre.scrollTop;
        });
    }

    function start() {
        if (!window.RingHighlight) return;
        var pres = document.querySelectorAll("article pre");
        for (var i = 0; i < pres.length; i++) {
            if (pres[i].closest(".runner")) continue;   /* the runner owns its own */
            if (pres[i].closest(".rh-shell")) continue; /* already done            */
            decorate(pres[i]);
        }
        var areas = document.querySelectorAll(".runner-code");
        for (var j = 0; j < areas.length; j++) {
            if (areas[j].dataset.rhDone) continue;
            areas[j].dataset.rhDone = "1";
            window.RingHighlight.editor(areas[j]);
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start);
    } else {
        start();
    }
    window.RingCode = { start: start };
})();
