/*
** RingScript Money — the browser half.
**
**     <script src="lib/money/money.js"></script>
**     const money = await Money.attach(ring);
**     const m = money.of(12.5, "EUR");        // {m:1250, c:"EUR"}
**     el.textContent = money.format(m);       // "12,50 €"
**
** Wiring only. Every decision — parsing, rounding, allocation, the
** refusal to mix currencies — is made in money.ring, on the device,
** where the rest of the world's rules live. A world written in Ring
** calls MoneyAdd/MoneyPercent/MoneyAllocate directly and never comes
** through here at all; these helpers exist for the page's DISPLAY code.
*/

(function (global) {
    "use strict";

    function ownBase() {
        var s = (typeof document !== "undefined") && document.currentScript;
        if (s && s.src) { return s.src.replace(/[^/]*$/, ""); }
        return "lib/money/";
    }
    var BASE = ownBase();

    function parse(res, who) {
        if (!res || !res.ok) { throw new Error("money: " + who + ": " + (res && res.error)); }
        var v = res.result;
        if (typeof v !== "string") { return v; }
        var t = v.trim();
        if (t.charAt(0) === "{" || t.charAt(0) === "[") {
            try { return JSON.parse(t); } catch (e) { return v; }
        }
        return v;
    }

    global.Money = {
        version: "1.0.0",

        /* opts.ringSource — inject the Ring half instead of fetching it
           (tests, bundled worlds). Otherwise it loads from beside this
           script, so the page configures nothing. */
        attach: async function (ring, opts) {
            opts = opts || {};
            var src = opts.ringSource;
            if (!src) { src = await (await fetch(BASE + "money.ring")).text(); }
            var ev = ring.eval(src);
            if (!ev.ok) { throw new Error("money: money.ring failed: " + ev.error); }

            var ask = function (fn, arg) { return parse(ring.call(fn, arg), fn); };

            return {
                /* number → rounded half-up; string → parsed EXACTLY */
                of: function (amount, cur) {
                    return ask("MoneyOfQ", JSON.stringify([amount, cur]));
                },
                parse: function (text, cur) {
                    return ask("MoneyParseQ", JSON.stringify([text, cur]));
                },
                format: function (m) {
                    return ask("MoneyFormatQ", JSON.stringify([m.m, m.c]));
                }
            };
        }
    };
})(typeof window !== "undefined" ? window : globalThis);
