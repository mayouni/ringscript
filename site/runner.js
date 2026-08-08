/*
** runner.js — the live Ring panel shared by the blog posts.
**
** One implementation for every post, so a fix lands everywhere. It expects
** the markup written by `.runner` in style.css and needs nothing else:
**
**   <div class="runner" data-title="…" data-note="…">
**     <textarea class="runner-code">…the program…</textarea>
**   </div>
**
** Everything else — the heading, the labels, the buttons, the output box —
** is built here from that one element, so a post carries only the program
** it wants to show.
**
** The runtime is fetched once per page, on the first Run of any panel, and
** every panel on the page shares that one VM.
*/
(function () {
    "use strict";

    var loading = null;             /* the in-flight load, shared by panels */

    function runtime() {
        if (!loading) {
            loading = fetch("playground/ringscript.wasm")
                .then(function (r) {
                    if (!r.ok) throw new Error("could not fetch the runtime (" + r.status + ")");
                    return r.arrayBuffer();
                })
                .then(function (bytes) {
                    return RingScript.load(bytes, { onOutput: function () {} });
                })
                .catch(function (e) { loading = null; throw e; });
        }
        return loading;
    }

    /* Grow the editor to the program it holds, so the reader meets the whole
       example instead of the middle of it — capped, because a long program
       must not push the rest of the page off the screen. */
    function fit(area) {
        area.style.height = "auto";
        var max = 48 * parseFloat(getComputedStyle(document.documentElement).fontSize);
        area.style.height = Math.min(area.scrollHeight + 2, max) + "px";
        /* the highlighted layer is absolutely positioned, so the wrapper
           has to be told the height the textarea just chose */
        var wrap = area.parentNode;
        if (wrap && wrap.classList.contains("rh-wrap")) {
            wrap.style.height = area.style.height;
        }
    }

    /* Tab indents, because this is code and not a form field — but Escape
       first releases the field, so the keyboard can still leave the panel.
       Trapping Tab outright would make the page unusable without a mouse. */
    function editorKeys(area) {
        var trapped = true;
        area.addEventListener("keydown", function (e) {
            if (e.key === "Escape") { trapped = false; return; }
            if (e.key !== "Tab" || !trapped || e.ctrlKey || e.altKey || e.metaKey) return;
            e.preventDefault();
            var s = area.selectionStart, t = area.selectionEnd;
            area.value = area.value.slice(0, s) + "\t" + area.value.slice(t);
            area.selectionStart = area.selectionEnd = s + 1;
            area.dispatchEvent(new Event("input"));
        });
        area.addEventListener("focus", function () { trapped = true; });
    }

    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    }

    function build(panel, index) {
        var area = panel.querySelector(".runner-code");
        if (!area) return;

        var original = area.value.replace(/^\n/, "").replace(/\s+$/, "");
        area.value = original;
        var id = "runner-code-" + (index + 1);
        area.id = id;

        /* --- head: what this is, and the way back --------------------- */
        var head = el("div", "runner-head");
        var h = el("h3", null, panel.dataset.title || "Run it here");
        head.appendChild(h);
        head.appendChild(el("p", null, panel.dataset.note
            || "The real RingScript runtime, in this page. Edit the program and run it."));
        /* Always live, never greyed out: the way back from an edit has to be
           reachable at every moment (rule 79), and restoring an example
           nobody touched is a harmless no-op. A control that is present but
           disabled makes the reader work out why. */
        var restore = el("button", "quiet", "Restore the example");
        restore.type = "button";
        head.appendChild(restore);

        /* --- the parts, each labelled -------------------------------- */
        var codeLabel = el("label", "runner-label", "The program — editable");
        codeLabel.setAttribute("for", id);
        var hint = el("span", "runner-hint", "Tab indents · Esc then Tab leaves the field");
        codeLabel.appendChild(hint);

        var bar = el("div", "runner-bar");
        var run = el("button", null, panel.dataset.run || "Run the program");
        run.type = "button";
        var status = el("span", "runner-status",
            "the runtime loads on the first run — about 400 KB, once");
        bar.appendChild(run);
        bar.appendChild(status);

        var outLabel = el("span", "runner-label", "Output");
        var out = el("pre", "runner-out");
        out.setAttribute("aria-live", "polite");

        panel.insertBefore(head, area);
        panel.insertBefore(codeLabel, area);
        panel.appendChild(bar);
        panel.appendChild(outLabel);
        panel.appendChild(out);

        fit(area);
        editorKeys(area);
        /* code.js turns this textarea into the editor a moment later; when
           it does, the height has to be recomputed against the editor's own
           line metrics rather than the bare textarea's. */
        requestAnimationFrame(function () { fit(area); });
        area.addEventListener("input", function () { fit(area); });

        restore.addEventListener("click", function () {
            area.value = original;
            fit(area);
            area.focus();
        });

        function say(text, bad) {
            status.textContent = text;
            status.className = "runner-status" + (bad ? " bad" : "");
        }

        run.addEventListener("click", function () {
            run.disabled = true;
            say("starting the Ring VM…");
            runtime().then(function (ring) {
                say("running…");
                var t0 = performance.now();
                var r = ring.eval(area.value);
                var ms = Math.round(performance.now() - t0);
                out.textContent = r.ok ? r.output : r.error;
                /* An error from Ring is a RESULT, not a failure of the page:
                   the VM caught it, is still holding its state, and said so.
                   Only a broken runtime deserves the red. */
                say(r.ok ? "ran in " + ms + " ms, inside this page"
                         : "Ring reported an error — the runtime is fine, "
                           + "which is the point");
            }).catch(function (e) {
                out.textContent = String((e && e.message) || e);
                say("the runtime could not start", true);
            }).then(function () { run.disabled = false; });
        });
    }

    function start() {
        var panels = document.querySelectorAll(".runner");
        for (var i = 0; i < panels.length; i++) build(panels[i], i);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start);
    } else {
        start();
    }
})();
