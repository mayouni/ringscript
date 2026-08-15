# Stock Count — an installable local-first app

A stock-count pad for a shop or a warehouse. Install it on the phone, walk
into a back room with no signal, count the shelves, and push the finished
count when a connection comes back.

It is the second RingScript sample, and it exists to show one thing the
first one could not: **how a local-first app actually gets onto the
device and stays there.**

```
open it in a browser → the browser offers to install it
                     → the service worker caches the runtime and the rules
                     → every later open needs no network at all
```

## Run it

Any static server; the service worker needs `https` or `localhost`.

```bash
zig build serve -- 8378 _site
```

then <http://localhost:8378/samples/stock-count/>. From the repository
root the sample reaches the runtime as `../../playground/`; in your own
project the two runtime files would sit beside the app.

## The files

| file | what it is | who writes this |
|---|---|---|
| `index.html` | the screens | your front-end developer |
| `app.css` | the look | your designer |
| `app.js` | the wires — DOM, storage, fetch, install | your front-end developer |
| **`count.ring`** | **the rules** | **whoever knows the business** |
| `sw.js` | the service worker — cache, offline, background sync | your front-end developer |
| `manifest.webmanifest` | what "installed" means | — |
| `expected.json` | what the server sends, once | your back end |

No build step, no framework, no bundler. Nine files.

## What Ring decides, and what it does not

`count.ring` never touches the DOM, never sees `localStorage`, and has
never heard of a service worker. It answers questions:

- is `39` a valid count for `RIZ-25`?
- one bag of rice short is 14,500 F — is that a miscount or a question for
  somebody?
- may this count be submitted yet?
- which five lines should a supervisor actually read?
- what exactly goes in the outbox, and what happens when a send fails?

That last group is why the rules cannot live on the server. A shop
assistant in a back room needs the verdict **now**, and the server is not
there.

Everything else — drawing the table, saving to `localStorage`, registering
the service worker, the install prompt — is ordinary web development, in
`app.js`, in JavaScript, where a web developer expects to find it.

## The PWA parts, and what each one buys

**`manifest.webmanifest`** makes it installable: a name, an icon, and
`display: standalone` so it opens without browser chrome. The browser
decides when to offer installation; the app only unhides its own button
when `beforeinstallprompt` fires.

**`sw.js` install** caches eleven files, including
`../../playground/ringscript.wasm`. A service worker's scope limits which
*pages* it controls, not which *resources* it may store — so the shared
runtime caches fine from a sample that does not contain it.

**`sw.js` fetch** answers from the cache first. That is the right choice
here because the cache is versioned by name: bump `CACHE` and the old one
is deleted on activate. Network-first with a cache fallback would make
every cold start wait for a timeout on a bad connection — the exact
situation this app is for.

**`sw.js` sync** is the part a plain website cannot do at all. The app
registers `flush-counts`, and the browser fires it when it next sees a
connection **even if the app is closed**. The worker moves an
already-decided payload; it computes nothing. The rules stayed in Ring.

## Measured

The whole application, runtime included:

| | bytes |
|---|---:|
| `ringscript.wasm` | 396,604 |
| `ringscript.js` | 39,366 |
| the app itself — HTML, CSS, JS, Ring, data, icons | ~33,000 |
| **total, cached once** | **~469 KB** |

After that first visit the network is used for exactly one thing: sending
finished counts.

**Proof rather than claim:** with the dev server stopped, a full page
reload still opens the app, loads the 397 KB runtime and `count.ring` from
cache, and restores the session. That is the whole promise of the pattern
in one test you can repeat.

## Two honest caveats

**`navigator.onLine` is not what you want it to mean.** It reports whether
the device has a network interface, not whether your server answers. Stop
the server and this app still says "Connection: up", because the browser
still sees Wi-Fi. Treat it as a hint; the real test is whether a request
succeeds, which is why the outbox rolls back on failure rather than
trusting a flag.

**Background Sync is not everywhere.** Chrome and Edge have it; Safari
does not. The app checks for it and says so in its own log, then falls
back to flushing whenever it is open and online. The feature degrades
instead of disappearing — which is the right shape for anything built on
a capability the platform may not have.

## Try this

1. Open it, count a few items — note that the verdicts arrive instantly.
2. Press **Cut the connection**, keep counting. Nothing changes.
3. Count everything, press **Queue this count**.
4. **Stop the server**, reload the page. The app still opens, still has
   your counts, still has the queued entry.
5. Start the server, press **Restore the connection**. The outbox drains.

## Related

- [`../route-orders/`](../route-orders/) — the same discipline applied to a
  field-sales order pad, with pricing tiers, credit limits and an outbox.
  Start there if you want the local-first argument; start here if you want
  to know how it gets installed.

## Built on ringscript-pwa

The installability, the offline shell and the outbox are not written here.
They come from a library:

```bash
ringscript add pwa
```

`count.ring` keeps the stock rules — what a variance is worth, whether one
needs investigating, whether the count may be submitted. The library owns
what queueing *means*: the id made on the device before anything is sent,
one entry at a time, and rollback when a send fails.

That split removed **191 lines** from this sample, and all of `sw.js` except
the list of files to cache — which is the one thing only this application
can know.

It also found a bug. Restoring the connection calls `flush()`, clicking
*Send now* calls `flush()`, and doing both within 100 ms had each read the
same entry as queued and send it. Fixed in
[ringscript-pwa 1.0.1](https://github.com/mayouni/ringscript-pwa/releases/tag/v1.0.1);
every application that uses the library gets the fix, which is the argument
for a library in one sentence.
