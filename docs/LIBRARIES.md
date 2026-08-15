# RingScript libraries — the ecosystem

The format a library takes, how it is distributed, and the tool that
installs it. Most of it is built; section 10 says exactly what is not.

---

## 1. Why this is not RingPM

The first draft of this document rode RingPM: a RingScript library would be
a RingPM package, and `ringpm install` would fetch it. That was wrong, and
the starter kit says why in its own words:

> **Everything needed to run it is already in this folder. Nothing to
> install.**

A RingScript user is a **web developer**. They downloaded a folder, they
double-click `start-windows.bat`, and a page runs. They have a browser and
that folder. **They do not have Ring installed**, and they have no reason
to — the VM they run is the WebAssembly one, not the desktop interpreter.

RingPM needs a Ring installation to exist at all. Making it the front door
to libraries would mean telling a web developer to install a language
runtime they will never invoke, in order to add a service worker to their
page. That trades the project's best property for reuse of somebody else's
plumbing.

There is a second, quieter reason. Ring and RingScript share a language and
nothing else: different VMs, different platforms, different release
cadences, different audiences. A `ringscript-pwa` package in Ring's registry
would be installable by Ring users for whom it does nothing at all. Two
ecosystems that share a syntax are still two ecosystems.

**So: a separate registry, a separate tool, no dependency on Ring.**

## 2. What already exists to build on

RingScript ships a **native binary, cross-compiled to five platforms**
(`bin/ringscript-serve-*`, built by `zig build dist`), and the starter kit
copies them into `server/`. It needs no runtime, no interpreter, and no
package manager. It is already in the user's hands.

That binary becomes the CLI. `ringscript-serve` grows into `ringscript`:

```
ringscript serve [port]              what it does today
ringscript new <folder>              scaffold a page

ringscript add <name>                install a library and wire it in
ringscript remove <name>             unwire and delete it
ringscript update [name]             newer versions, respecting the lock
ringscript list                      what this project uses
ringscript search <term>             the registry
ringscript pack                      validate a library, ready to publish
```

Written in Zig, so the whole ecosystem inherits the property that made the
starter kit work: **nothing to install.**

## 3. The registry

Its own repository — `ringscript-registry` — holding one file:

```json
{
  "schema": 1,
  "packages": [
    {
      "name": "pwa",
      "summary": "Install to the home screen, work offline, and a durable outbox.",
      "repo": "mayouni/ringscript-pwa",
      "author": "Mansour Ayouni",
      "license": "MIT",
      "versions": [
        { "version": "1.0", "tag": "v1.0", "ringscript": ">=0.9",
          "sha256": "…" }
      ]
    }
  ]
}
```

Fetched over plain HTTPS from `raw.githubusercontent.com`. No server to run,
no database, no account system — the same reasoning that makes RingPM's
registry a file in a repository, applied to a registry that is ours.

Its own repository rather than a folder in this one, because it changes when
*other people* publish, on a cadence that has nothing to do with runtime
releases, and needs a different permission surface.

## 4. Install, concretely

`ringscript add pwa` does this, and nothing surprising:

1. fetch the registry (cached; a second project installs with no network);
2. resolve the newest version whose `ringscript` range this runtime
   satisfies — refuse politely rather than fail later in a browser;
3. download `codeload.github.com/<repo>/tar.gz/refs/tags/<tag>`;
4. **verify the sha256 against the registry** before unpacking anything;
5. read the library's `ringscript.json`, unpack only the files it declares,
   into `lib/<name>/`;
6. wire the page: one `<script>` per web entry before `</body>`, one
   `<link>` per stylesheet in `<head>`, an `importScripts` line and cached
   shell entries if it has a service-worker half;
7. write `ringscript.lock` — name, version, tag, hash;
8. record what was touched, so `remove` undoes exactly that and no more.

Gzip, tar, sha256 and TLS are all in Zig's standard library. No vendored
dependency, consistent with how the runtime itself is built.

## 5. Why this is a better experience than the alternative

| | RingPM route | this |
|---|---|---|
| prerequisite | a Ring installation | none — the binary ships with the project |
| install | fetches files | fetches files **and wires the page** |
| reproducible | version + branch | lockfile with hashes |
| offline | no | yes, after one fetch — which matters where this is used |
| uninstall | delete a folder, edit your HTML by hand | exact, from what was recorded |
| audience | Ring developers | web developers |

Point two is the substance. Every other package manager stops at "the files
are on disk"; the remaining work — a script tag, a stylesheet link, a
service-worker import, a cache list — is left to the reader and is exactly
where a beginner stalls.

## 6. The library format

Unchanged from the first draft, because the format was never the part that
was wrong. Distribution and layout are separable questions.

```
ringscript-pwa/
  ringscript.json       the manifest
  ring/pwa.ring         the Ring half — logic, no DOM, no fetch
  web/pwa.js            the browser half — the wires
  web/sw-pwa.js         optional service-worker half
  web/pwa.css           optional
  assets/               optional
  example/              a runnable page
  README.md
```

JSON rather than a Ring file, now that the installer is Zig and no Ring
interpreter is in the loop.

```json
{
  "name": "pwa",
  "version": "1.0",
  "ringscript": ">=0.9",
  "summary": "Install to the home screen, work offline, and a durable outbox.",
  "ring": ["ring/pwa.ring"],
  "web": ["web/pwa.js"],
  "css": [],
  "sw": "web/sw-pwa.js",
  "assets": [],
  "provides": ["PwaOutboxAdd", "PwaOutboxList", "…"],
  "global": "Pwa"
}
```

Two rules give the layout meaning, and they are the ones the samples follow:

- **`ring/` never touches the browser** — no DOM, no `fetch`, no
  `localStorage`. It decides and returns values, so it is testable with no
  page at all.
- **`web/` makes no business decisions.** A rule found in `web/` is in the
  wrong file. A library that decides in JavaScript quietly undoes the reason
  someone chose RingScript.

`provides` and `global` are what make an ecosystem survivable: Ring has one
flat function namespace and a page has one `window`. Without a declared
surface, the second library you install breaks the first in a way nobody can
debug. `ringscript pack` refuses a library whose `provides` share no common
prefix, and `add` refuses one whose names are already taken.

## 7. The browser half is self-installing

One entry point, one line in the page:

```html
<script src="lib/pwa/pwa.js"></script>
```

The script loads its own Ring half. The page never fetches `pwa.ring` or
remembers to eval it in the right order — that ceremony is what stops people
using libraries at all.

```js
const pwa = await Pwa.attach(ring, { device: "phone-7", send: post });
```

## 8. Publishing

1. `ringscript pack` until it passes.
2. Push to `github.com/<you>/<name>`, tag a release.
3. Open a pull request on `ringscript-registry` adding one row, with the
   tag's sha256 — which `pack` prints.

No account, no token, no publish command with credentials. The registry is
a file, and a pull request is the review.

## 9. What a library must never do

- **Ship the runtime.** `ringscript.js` and `ringscript.wasm` belong to the
  application, and a page has one VM.
- **Assume it is alone.** Prefix everything, declare it, keep to one global.
- **Reach for Ring's registry.** A RingScript library is not a Ring package.
  It would be installable by Ring users for whom it does nothing.

## 10. Status

**Built and working:**

| verb | state |
|---|---|
| `pack [folder]` | validates a library and prints its registry row |
| `add <path> [project]` | installs from a folder and wires the page |
| `remove <name> [project]` | unwires and deletes, from what was recorded |
| `list [project]` | reads the lockfile |
| `search [term]` | fetches the registry over HTTPS |
| `serve [port] [root]` | unchanged, and the old positional form still works |

Verified end to end: `add` copies the declared files, injects one script tag
before `</body>`, writes `ringscript.lock`; adding twice does not duplicate
the tag; `remove` leaves `index.html` **byte-identical** to before the
install. TLS was proved by pointing the registry URL at a real file and
parsing it.

**Not built yet:** `add <name>` from the registry. Resolving a name needs
the tarball path — download, sha256, gunzip, untar — and the pieces are all
in Zig's standard library (`std.compress.flate`, `std.tar`,
`std.crypto.hash.sha2`), but it is the one part with no test to run against
until a library is actually published. `add <path>` covers the author's
loop today, which is what a library needs before there is anything to
publish.

The registry itself is `ringscript-registry`, committed and empty — a
registry with an unverifiable entry is worse than an empty one.
