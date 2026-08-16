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
ringscript search [term]             list the registry, or match a term
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

1. fetch the registry — network first, cache when the network is not there;
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

**A limitation worth knowing.** `add` wires `index.html`, because that is
the page a one-page project has. A folder holding several pages gets the tag
on `index.html` only — which may not be the page that wanted it. Installing
`table` into `playground/` put a script tag on the Playground itself and
none on the register that actually uses it. Either move the tag by hand, or
load the library's Ring half from the page that needs it, which is what the
register does.

Gzip, tar, sha256 and TLS are all in Zig's standard library. No vendored
dependency, consistent with how the runtime itself is built.

### `update`, and the order that makes it safe

`ringscript update` runs steps 1–8 again for every package the lockfile
records — or one, given a name — and resolves through the **same** function
`add` uses, so the two can never disagree about which version is "the" one.

The ordering is the whole design. `remove` then `add` would do the same job,
and it is what everyone does before this verb exists, but it has a window in
the middle where the project has no library at all: if the download fails
there, the page is broken and the lockfile no longer says what to restore.
So `update` **fetches, verifies against the hash, and unpacks to a temporary
folder before it deletes anything**. A failure at any point up to that leaves
the project untouched — files, script tags, lockfile entry — and says so:

```
  could not download it (ConnectionRefused)
  kept v1.0.0 — the new version could not be fetched
```

Three refusals, all deliberate:

- **never backwards** — if the registry's newest is older than what is
  installed, the answer is `current`. A pulled release must not silently
  downgrade a working project;
- **never a path install** — a library added from a folder is left alone with
  a note, because nothing here can know what that folder holds now;
- **never a version this runtime does not satisfy** — same check as `add`.

Offline, it works from the registry cache and the package cache, so a machine
that has seen a version before can move to it with no network at all.

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
| `add <name>` | resolves the registry, verifies the hash, unpacks, wires the page |
| `add <path> [project]` | the same from a folder, for a library author |
| `update [name] [project]` | fetches and unpacks the new version before deleting the old |
| `remove <name> [project]` | unwires and deletes, from what was recorded |
| `list [project]` | reads the lockfile |
| `search [term]` | lists the registry over HTTPS, or matches a term |
| `serve [port] [root]` | unchanged, and the old positional form still works |

Verified end to end: `add` copies the declared files, injects one script tag
before `</body>`, writes `ringscript.lock`; adding twice does not duplicate
the tag; `remove` leaves `index.html` **byte-identical** to before the
install. TLS was proved by pointing the registry URL at a real file and
parsing it.

**The install path, proved against the published library:**

```
$ ringscript add pwa
  fetching pwa v1.0
  verified 10755 bytes against the registry hash
  wired into index.html
  added pwa v1.0 to .
```

And the three refusals, which are the part worth having:

| given | what happens |
|---|---|
| a download that does not match the registry hash | `REFUSED`, both hashes printed, **nothing written** |
| a version needing a newer runtime than 0.9 | refused with a count of how many were skipped |
| a name that is not in the registry | said plainly |

The archive is unpacked into `.ringscript-unpack` and only then installed,
so a bad archive cannot leave half a library in `lib/`. The directory is
removed either way. `remove` then restores `index.html` **byte-identical**,
whether the package came from the registry or a path.

### Caching, and why it is shaped this way

Two caches, both per user rather than per project, under the platform's
application-data directory:

| | |
|---|---|
| `ringscript/registry.json` | the last registry that parsed |
| `ringscript/packages/<sha256>.tar.gz` | every package ever downloaded |

**The registry is network-first, cache-second.** Cache-first would be
faster and would serve stale rows to somebody perfectly well connected.
This way a connected machine is always current and a disconnected one still
works — and it says which it used:

```
  offline (UnknownHostName) — using the registry cached today
  table v1.2.0 — already downloaded, no network needed
```

**Packages are keyed by their own sha256**, which is what makes the cache
safe rather than merely convenient. A cache hit *is* the verified bytes, so
there is no way to serve something the registry never named. Entries are
re-hashed on read: one that no longer matches its own filename is a
corrupted file, not a package — it is deleted and re-fetched rather than
trusted for being local.

Together they mean the second project on a laptop installs with **no
network at all**, which is the case this whole project exists for.

A stale registry cannot make an install unsafe. The worst it can do is
offer an older version than exists.

### `update`, proved

Every path was exercised against the published registry, with `pwa` pinned
back to v1.0 and `table` to v1.0.0:

| given | what happens |
|---|---|
| a newer version exists | fetched, verified, unpacked, old files removed, page rewired, lockfile advanced |
| already newest | `pwa v1.1.0 — current`, nothing written |
| installed version **ahead** of the registry | `current` — it does not go backwards |
| installed from a path | left alone with a note to re-add from the folder |
| the download fails | `kept v1.0.0` — files, script tag and lockfile entry all unchanged, exit 0 |
| the registry host is unreachable | cache used, and a cached package installed with no network at all |

The last two are the reason the verb exists. The failing-download case was
produced by pointing a cached registry row at a dead port and clearing that
package from the cache; the update declined and the project still ran.

Updating does not duplicate the script tag: the old entry's tag is removed
while its file list is still known, and the new install writes one back.

`RINGSCRIPT_REGISTRY` overrides the registry with a URL or a local file — a
mirror inside an organisation, a copy on a machine that cannot reach GitHub,
or a fixture under test. The three refusals above were tested exactly that
way.

## 11. The ecosystem, live

| | |
|---|---|
| registry | [ringscript-registry](https://github.com/mayouni/ringscript-registry) — one JSON file, a pull request is the review |
| first library | [ringscript-pwa](https://github.com/mayouni/ringscript-pwa) v1.0 |

```
$ ringscript search outbox

  Libraries matching "outbox":

    pwa  1.1.0
      Install to the home screen, work offline, and a durable outbox with
      rollback - one entry at a time or a batch the server answers per entry.

  Install it:  ringscript add pwa
```

The registry pins an **uploaded release asset**, not GitHub's auto-generated
source archive: those are produced on demand and are not guaranteed
byte-stable, so pinning a hash to one pins it to something that can change
underneath. The published asset was downloaded back and re-hashed before the
row went in — 10,755 bytes, `2899a17a…`, match.

`libs/pwa` no longer lives here. A library consumed by many projects belongs
in none of them, which is the same rule that moved the upstream register to
RingUpstream.
