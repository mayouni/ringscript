/*
** RingScript Table — the browser half.
**
**     <script src="lib/table/table.js"></script>
**     const t = await Table.attach(ring);
**     t.load(["id","member","amount","status"], rows);
**     t.filter([{ column: "status", op: "eq", value: "ACTIVE" }]);
**     t.sort("amount", true);
**     render(t.page(1, 25));
**
** Wiring only. Every decision — what matches, what the total is, which
** group leads — is made in table.ring, on the device.
*/

(function (global) {
    "use strict";

    function ownBase() {
        var s = document.currentScript;
        if (s && s.src) { return s.src.replace(/[^/]*$/, ""); }
        return "lib/table/";
    }
    var BASE = ownBase();

    function parse(res, who) {
        if (!res || !res.ok) { throw new Error("table: " + who + ": " + (res && res.error)); }
        var v = res.result;
        if (typeof v !== "string") { return v; }
        var t = v.trim();
        if (t.charAt(0) === "{" || t.charAt(0) === "[") {
            try { return JSON.parse(t); } catch (e) { return v; }
        }
        return v;
    }

    global.Table = {
        version: "1.1.0",

        attach: async function (ring) {
            var src = await (await fetch(BASE + "table.ring")).text();
            var ev = ring.eval(src);
            if (!ev.ok) { throw new Error("table: table.ring failed: " + ev.error); }

            var ask = function (fn, arg) {
                return parse(ring.call(fn, arg === undefined ? 1 : arg), fn);
            };
            var pairs = function (o) {
                return Object.keys(o).map(function (k) { return [k, o[k]]; });
            };

            return {
                /* Columns and rows, not records. The same 20,000 rows as
                   JSON objects cost 19x more to load and four times the
                   memory — so this takes arrays. */
                load: function (columns, rows) {
                    return ask("TableLoad", JSON.stringify([["columns", columns], ["rows", rows]]));
                },

                /* [{ column, op, value }] — every test must pass.
                   ops: eq ne gt ge lt le contains starts */
                filter: function (tests) {
                    return ask("TableFilter", JSON.stringify((tests || []).map(pairs)));
                },
                all: function () { return ask("TableAll", 0); },

                sort: function (column, desc) {
                    return ask("TableSort", JSON.stringify([["column", column], ["desc", desc ? 1 : 0]]));
                },

                /* The only call that hands row data back, and it hands back
                   one screenful. */
                page: function (from, count) {
                    return ask("TablePage", JSON.stringify([["from", from || 1], ["count", count || 25]]));
                },
                row: function (at) { return ask("TableRow", at); },

                /* Over the current view, so it answers "what am I looking
                   at" rather than "what is in the table". */
                /* where is optional: totals a subset WITHOUT disturbing
                   the view, so "the sum of what counts, and how many did
                   not" costs one pass rather than three. */
                aggregate: function (column, where) {
                    var spec = [["column", column]];
                    if (where) { spec.push(["where", where.map(pairs)]); }
                    return ask("TableAggregate", JSON.stringify(spec));
                },
                group: function (by, value, top) {
                    return ask("TableGroup", JSON.stringify([["by", by], ["value", value || ""], ["top", top || 10]]));
                },

                append: function (row) { return ask("TableAppend", JSON.stringify(row)); },
                set: function (at, column, value) {
                    return ask("TableSet", JSON.stringify([["at", at], ["column", column], ["value", value]]));
                },

                count: function () { return ask("TableCount", 0); },
                viewCount: function () { return ask("TableViewCount", 0); },
                columns: function () { return ask("TableColumns", 0); },

                /* The index is built lazily by the reads that need it. This
                   is here for the case where you want the cost paid at a
                   moment you choose — after a bulk load, before a render. */
                index: function () { return ask("TableIndex", 0); },
                indexFloor: function (n) { return ask("TableIndexFloor", n); },

                snapshot: function () { return ring.call("TableSnapshot", 0).result; },
                restore: function (json) { return ask("TableRestore", json); }
            };
        }
    };
})(window);
