# Using and writing libraries

A tutorial. By the end you will have installed a library into a page, used
it, removed it again, written one of your own, tested it with no browser,
and know exactly what publishing involves.

For the format's specification and the reasoning behind it, see
[LIBRARIES.md](LIBRARIES.md). This document is the hands-on half.

---

## 1. What a RingScript library is

Two halves, and the split is the whole idea:

| | |
|---|---|
| `ring/` | the rules — no DOM, no `fetch`, no `localStorage`. It decides things and returns values. |
| `web/` | the wiring — moves data between your page and the VM. Makes no business decisions. |

That is the same division your own application should already have. A
library is just that division, packaged.

Distribution is **not** RingPM. A RingScript library is JavaScript, CSS and
Ring aimed at a browser; RingPM installs Ring source for the desktop, and
needs a Ring installation you probably do not have. RingScript ships its own
registry and its own installer, and the installer is the binary already in
your folder.

## 2. Install one

Start from any folder with an `index.html`. From inside it:

```bash
ringscript search outbox
```

```
  Libraries matching "outbox":

    pwa  2.0.0
      Partition-tolerant by default: a durable outbox with ordered idempotent
      replay, the degraded-mode rung readable by Ring rules, and
      snapshot/stream with the 8-second alarm.

  Install it:  ringscript add pwa
```

With no term it lists everything the registry holds.

Then:

```bash
ringscript add pwa
```

```
  fetching pwa v2.0.0
  verified 23506 bytes against the registry hash
  wired into index.html
  added pwa v2.0.0 to .
  service-worker half at lib/pwa/sw-pwa.js — importScripts it from your sw.js
```

Four things happened, and the third is the one other package managers leave
to you:

1. the download was checked against the registry's sha256 **before**
   anything was unpacked;
2. the library's files landed in `lib/pwa/`;
3. `<script src="lib/pwa/pwa.js"></script>` went into your `index.html`
   before `</body>`;
4. `ringscript.lock` recorded what was installed and which files were
   touched.

If the hash had not matched, nothing would have been written at all.

> **Where does `ringscript` come from?** It is the same binary that serves
> your pages — `server/ringscript-serve-*` in the starter kit. Rename it,
> alias it, or call it by path; there is nothing to install.

**More than one page?** Say which one:

```bash
ringscript add pwa --page reports.html
```

wires `pwa` into `reports.html` and leaves `index.html` alone — asking for
one page does not mean wanting both. Run it again with a different
`--page` on the same library and it adds to what that library reaches
rather than replacing it; `ringscript.lock` keeps the whole list, so
`remove` unwires every page it finds there, not just the last one you
named.

## 3. Use it

A library exposes one global and loads its own Ring half, so your page does
not fetch or `eval` anything:

```js
const pwa = await Pwa.attach(ring, {
    world:  "route-orders",             // REQUIRED — the storage identity:
                                        // storage is keyed by this name,
                                        // never by where the page is served
    device: "van-3",                    // stable per device or user
    endpoint: "/api/orders",            // same-origin; flush() sends one
                                        // ordered batch, answered per entry
    sw: "sw.js",                        // your service worker, or null
    onChange: render                    // called whenever the queue changes
});

const q = await pwa.queue("order", { shop: "m03", total: 4200 });
if (!q.ok) show(q.problem);             // "storage-full" is loud, never lost
```

`queue()` answers a Promise because the entry is **durable before `ok`** —
a store that cannot hold it refuses by name instead of accepting work it
cannot keep. Everything else about the call works with no network at all.

Note `ring` is passed **in**. One page has one VM, and the library uses
yours rather than starting its own.

The library's Ring functions are part of its public surface too — they are
declared in its manifest — so calling them directly is legitimate when you
need something the JavaScript wrapper does not expose:

```js
const entry = ring.call("PwaOutboxPayload", id);
```

## 4. Update it

```bash
ringscript update
```

With no name it looks at everything the lockfile records; with one — `ringscript
update pwa` — just that library. Either way it prints a line per package, so a
run that changes nothing still tells you where you stand:

```
  pwa v1.1.0 -> v2.0.0
  fetching pwa v2.0.0
  verified 23506 bytes against the registry hash
  wired into index.html
  added pwa v2.0.0 to .
  table v1.2.0 — current
```

Three things it will not do.

**It will not move you backwards.** If the registry offers an older version
than the one you have — because a release was pulled, or because you are
running something not published yet — it says `current` and leaves you alone.

**It will not leave you with nothing.** The new version is downloaded, checked
against the registry's hash and unpacked before a single old file is deleted. A
download that fails mid-update prints

```
  could not download it (ConnectionRefused)
  kept v1.1.0 — the new version could not be fetched
```

and your project is exactly as it was: files, script tag, lockfile entry. This
is why the verb is worth having rather than `remove` then `add` — that pair has
a window in the middle where the library is gone.

**It will not touch a library you installed from a folder.** Those say

```
  pwa v2.0.0 — installed from a path; re-add it from that folder to refresh
```

because nothing here can know whether that folder still exists, or still holds
what it held. Re-run `ringscript add <folder>` when you want the newer copy.

Updates work offline once you have the files. The registry falls back to its
local cache, and a version you have downloaded before is not downloaded again:

```
  offline (ConnectionRefused) — using the registry cached today
  table v1.2.0 — already downloaded, no network needed
```

## 5. Remove it

```bash
ringscript remove pwa
```

It undoes exactly what the install recorded and nothing else: the files, the
script tag, the lockfile entry. After an add and a remove, your
`index.html` is byte-identical to before.

That is worth trying once, precisely because it is the part you will
otherwise never trust.

## 6. Write one

```bash
ringscript pack .
```

Run it in an empty folder and it will tell you there is no manifest. Here is
the layout to create:

```
my-lib/
  ringscript.json
  ring/tally.ring
  web/tally.js
  README.md
```

**`ringscript.json`**

```json
{
  "name": "tally",
  "version": "0.1",
  "ringscript": ">=0.9",
  "summary": "Running totals with a rule about when a total is suspicious.",
  "ring": ["ring/tally.ring"],
  "web": ["web/tally.js"],
  "css": [],
  "sw": "",
  "assets": [],
  "provides": ["TallyAdd", "TallyTotal", "TallySuspicious"],
  "global": "Tally"
}
```

**`ring/tally.ring`** — the rules. No browser here at all:

```ring
aTallyRows = []
nTallyLimit = 100000

func TallyAdd cJson
	aIn = JsonDecode(cJson)
	aTallyRows + aIn
	return len(aTallyRows)

func TallyTotal p
	n = 0
	for i = 1 to len(aTallyRows)
		n = n + aTallyRows[i][2]
	next
	return n

# A rule, not a calculation: what counts as worth a second look.
func TallySuspicious p
	return JsonEncode([ :total = TallyTotal(1),
			    :suspicious = (TallyTotal(1) > nTallyLimit) ])
```

**`web/tally.js`** — the wiring, and it loads its own Ring half:

```js
(function (global) {
    "use strict";
    function ownBase() {
        var s = document.currentScript;
        return (s && s.src) ? s.src.replace(/[^/]*$/, "") : "lib/tally/";
    }
    var BASE = ownBase();

    global.Tally = {
        attach: async function (ring) {
            var src = await (await fetch(BASE + "tally.ring")).text();
            var ev = ring.eval(src);
            if (!ev.ok) { throw new Error("tally: " + ev.error); }
            return {
                add: function (row) { return ring.call("TallyAdd", JSON.stringify(row)).result; },
                suspicious: function () {
                    return JSON.parse(ring.call("TallySuspicious", 1).result);
                }
            };
        }
    };
})(window);
```

Now validate it:

```bash
ringscript pack my-lib
```

```
  tally v0.1
  ok — 3 functions, global Tally
```

`pack` refuses more than missing files. It checks that every name in
`provides` actually exists in your Ring source, and that those names share a
prefix. Ring has **one flat function namespace** and a page has one
`window`; without that rule, the second library somebody installs breaks the
first in a way nobody can debug.

Try breaking it on purpose — add a name to `provides` that is not in the
source — and watch it refuse. Then put it back.

## 7. Test the Ring half with no browser

This is what the split buys you. The rules are callable from Node against
any RingScript checkout:

```js
const fs = require("fs"), path = require("path");
const RUNTIME = path.join(process.env.RINGSCRIPT_HOME, "playground");
const RingScript = require(path.join(RUNTIME, "ringscript.js"));

(async () => {
    const b = fs.readFileSync(path.join(RUNTIME, "ringscript.wasm"));
    const vm = await RingScript.load(
        b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
        { onOutput: () => {} });
    vm.eval(fs.readFileSync("ring/tally.ring", "utf8"));

    vm.call("TallyAdd", JSON.stringify(["rent", 60000]));
    vm.call("TallyAdd", JSON.stringify(["stock", 50000]));
    const v = JSON.parse(vm.call("TallySuspicious", 1).result);
    console.log(v.total === 110000 && v.suspicious ? "PASS" : "FAIL");
})();
```

```bash
RINGSCRIPT_HOME=../ringscript node test.js
```

No page, no server, no browser. If a rule is hard to test this way, it is
probably in the wrong half.

## 8. Publish

Three steps, and there is no account to make.

**1. Tag it and attach a tarball you built yourself.**

```bash
git tag -a v0.1 -m "tally 0.1"
git push origin v0.1
git archive --format=tar.gz --prefix=tally-0.1/ -o tally-0.1.tar.gz v0.1
sha256sum tally-0.1.tar.gz
gh release create v0.1 tally-0.1.tar.gz
```

Attach your own tarball rather than pointing at GitHub's auto-generated
source archive. Those are produced on demand and are **not guaranteed
byte-stable**; pinning a hash to one pins it to something that can change
underneath you. An asset you upload cannot.

**2. Download it back and re-hash it.** It takes a moment and it is the only
way to know the row you are about to write is true.

**3. Open a pull request** on
[ringscript-registry](https://github.com/mayouni/ringscript-registry)
adding one row:

```json
{
  "name": "tally",
  "summary": "Running totals with a rule about when a total is suspicious.",
  "repo": "you/ringscript-tally",
  "license": "MIT",
  "versions": [
    { "version": "0.1", "tag": "v0.1", "ringscript": ">=0.9",
      "url": "https://github.com/you/ringscript-tally/releases/download/v0.1/tally-0.1.tar.gz",
      "sha256": "…" }
  ]
}
```

`ringscript pack` prints most of that for you.

## 9. Two rules that keep an ecosystem survivable

**Prefix everything, and declare it.** `provides` and `global` are not
bureaucracy. They are what lets a page load two libraries without one
silently redefining the other's functions.

**Never ship the runtime.** `ringscript.js` and `ringscript.wasm` belong to
the application. A page has one VM, and a library that brings its own would
give it a second.

## 10. Where to go from here

- [LIBRARIES.md](LIBRARIES.md) — the format specification and why the
  ecosystem is separate from Ring's.
- [ringscript-pwa](https://github.com/mayouni/ringscript-pwa) — a real
  library written to this format, with its tests.
- [`samples/route-orders`](../samples/route-orders/) and
  [`samples/stock-count`](../samples/stock-count/) — two applications
  sharing it, which is what found its last two bugs.

## 11. A last word on why

Both samples had written the same outbox before this existed. Extracting it
did not just remove 383 lines; installing it into the *second* application
found a duplicate send that the first had been hiding, and the *third* forced
the API to change shape.

A library is not code you moved. It is code that now has more than one
reader — and the second reader is the one who tells you what you got wrong.
