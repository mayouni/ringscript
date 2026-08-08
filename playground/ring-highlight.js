/*
** ring-highlight.js — the Ring syntax highlighter, and the little editor
** that wraps it. One implementation, shared by the Playground and by every
** code block on the site, so a fix to either lands in both.
**
** Two exports on `window.RingHighlight`:
**
**   highlight(src) -> HTML string
**       Tokens are wrapped in <span class="tok-kw|tok-str|tok-num|tok-com|
**       tok-atom|tok-fn">. The caller owns the colours.
**
**   editor(textarea, {readOnly}) -> { refresh() }
**       Turns a <textarea> into the Playground's editor: a line gutter, a
**       highlighted layer underneath a transparent textarea, and the current
**       line marked. The textarea stays a real textarea — selection, undo,
**       find-in-page and screen readers all keep working, which is the whole
**       reason for doing it this way rather than with contenteditable.
**
** No dependencies, no build step, classic script.
*/
(function () {
    "use strict";

    var KEYWORDS = new Set(("see give put get but ok if else elseif for to next while end do again " +
        "return func def function endfunction endfunc class endclass endpackage from new try catch done " +
        "switch on other off exit loop step in load import private package bracestart braceend " +
        "braceexpreval braceerror bracenewline changeringkeyword changeringoperator and or not " +
        "true false nl null main init self this super raise").split(" "));

    function escapeHtml(s) {
        return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    function highlight(src) {
        var out = "", i = 0, n = src.length;
        /* Ring identifiers may hold non-ASCII letters -- Arabic keywords
           via ChangeRingKeyword, accented names -- so everything from
           U+00A0 up counts. Written as escapes: the literal range is
           invisible in an editor, and one stray byte there would quietly
           change what the highlighter thinks a name is. */
        var isIdStart = function (c) { return /[A-Za-z_\u00A0-\uFFFF]/.test(c); };
        var isId = function (c) { return /[A-Za-z0-9_\u00A0-\uFFFF]/.test(c); };
        while (i < n) {
            var c = src[i], j, k, word;
            /* comments */
            if (c === "#" || (c === "/" && src[i + 1] === "/")) {
                j = i;
                while (j < n && src[j] !== "\n") j++;
                out += '<span class="tok-com">' + escapeHtml(src.slice(i, j)) + "</span>";
                i = j;
                continue;
            }
            if (c === "/" && src[i + 1] === "*") {
                j = i + 2;
                while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++;
                j = Math.min(n, j + 2);
                out += '<span class="tok-com">' + escapeHtml(src.slice(i, j)) + "</span>";
                i = j;
                continue;
            }
            /* strings — Ring has no escape sequences */
            if (c === '"' || c === "'" || c === "`") {
                j = i + 1;
                while (j < n && src[j] !== c) j++;
                j = Math.min(n, j + 1);
                out += '<span class="tok-str">' + escapeHtml(src.slice(i, j)) + "</span>";
                i = j;
                continue;
            }
            /* :atoms */
            if (c === ":" && i + 1 < n && isIdStart(src[i + 1])) {
                j = i + 1;
                while (j < n && isId(src[j])) j++;
                out += '<span class="tok-atom">' + escapeHtml(src.slice(i, j)) + "</span>";
                i = j;
                continue;
            }
            /* numbers */
            if (/[0-9]/.test(c)) {
                j = i;
                while (j < n && /[0-9._eE+\-xXa-fA-F]/.test(src[j])) {
                    if ((src[j] === "+" || src[j] === "-") && !/[eE]/.test(src[j - 1])) break;
                    j++;
                }
                out += '<span class="tok-num">' + escapeHtml(src.slice(i, j)) + "</span>";
                i = j;
                continue;
            }
            /* identifiers and keywords; a name followed by "(" reads as a call */
            if (isIdStart(c)) {
                j = i;
                while (j < n && isId(src[j])) j++;
                word = src.slice(i, j);
                k = j;
                while (k < n && (src[k] === " " || src[k] === "\t")) k++;
                if (KEYWORDS.has(word.toLowerCase())) {
                    out += '<span class="tok-kw">' + escapeHtml(word) + "</span>";
                } else if (src[k] === "(") {
                    out += '<span class="tok-fn">' + escapeHtml(word) + "</span>";
                } else {
                    out += escapeHtml(word);
                }
                i = j;
                continue;
            }
            out += escapeHtml(c);
            i++;
        }
        return out;
    }

    /* ------------------------------------------------------------ editor
       Builds the Playground's three-layer arrangement around an existing
       textarea: gutter | (current-line band, highlighted text, textarea).
       The textarea keeps its own scrolling and the other layers follow it. */
    function editor(area, opts) {
        opts = opts || {};
        var doc = area.ownerDocument;

        var shell = doc.createElement("div");
        shell.className = "rh-shell";
        var gutter = doc.createElement("div");
        gutter.className = "rh-gutter";
        gutter.setAttribute("aria-hidden", "true");
        var wrap = doc.createElement("div");
        wrap.className = "rh-wrap";
        var band = doc.createElement("div");
        band.className = "rh-line";
        var pre = doc.createElement("pre");
        pre.className = "rh-code";
        pre.setAttribute("aria-hidden", "true");

        area.parentNode.insertBefore(shell, area);
        shell.appendChild(gutter);
        shell.appendChild(wrap);
        wrap.appendChild(band);
        wrap.appendChild(pre);
        wrap.appendChild(area);
        area.classList.add("rh-input");
        if (opts.readOnly) {
            area.readOnly = true;
            shell.classList.add("rh-readonly");
        }

        var lines = 0;
        function refresh() {
            var src = area.value;
            pre.innerHTML = highlight(src) + "\n";
            var count = src.split("\n").length;
            if (count !== lines) {
                var html = "";
                for (var i = 1; i <= count; i++) html += "<div>" + i + "</div>";
                gutter.innerHTML = html;
                lines = count;
            }
            mark();
            sync();
        }
        /* the band under the caret's line, and the matching gutter number */
        function mark() {
            var upto = area.value.slice(0, area.selectionStart).split("\n").length;
            var lh = parseFloat(getComputedStyle(pre).lineHeight) || 0;
            var pad = parseFloat(getComputedStyle(pre).paddingTop) || 0;
            band.style.top = (pad + (upto - 1) * lh) + "px";
            band.style.height = lh + "px";
            var kids = gutter.children;
            for (var i = 0; i < kids.length; i++) kids[i].className = (i === upto - 1) ? "cur" : "";
            band.hidden = !!opts.readOnly && !area.matches(":focus");
        }
        function sync() {
            pre.scrollTop = area.scrollTop;
            pre.scrollLeft = area.scrollLeft;
            gutter.scrollTop = area.scrollTop;
            band.style.marginTop = (-area.scrollTop) + "px";
        }

        area.addEventListener("input", refresh);
        area.addEventListener("scroll", sync);
        area.addEventListener("click", mark);
        area.addEventListener("keyup", mark);
        area.addEventListener("focus", mark);
        area.addEventListener("blur", mark);
        refresh();
        return { refresh: refresh, shell: shell };
    }

    window.RingHighlight = { highlight: highlight, editor: editor };
})();
