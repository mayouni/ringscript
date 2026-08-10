# RingScript samples

Complete, working web projects you can open, read in a sitting, and take
apart. Each one is an ordinary front end — HTML, CSS, JavaScript, no build
step, no dependencies — with the **business logic written in Ring** and
running in the browser.

They exist to show a shape rather than a language. The shape is the same
every time:

| | |
|---|---|
| `index.html`, `app.css` | the interface — the markup and styling you already write |
| `app.js` | the wires — `fetch`, storage, the DOM, event handlers |
| `*.ring` | the business logic and the data processing |
| your server | HTTP endpoints that speak JSON, in whatever language you already use |

**Ring never draws anything.** It does not touch the DOM and has not heard
of `localStorage`. It answers questions, and the page decides how the
answers look. Rewrite the front end in React tomorrow and the Ring file does
not change — and neither does your back end.

## The samples

| Sample | What it shows |
|---|---|
| **[route-orders](route-orders/)** | A field-sales order pad, built local-first: price tiers, discounts, tax, stock and the credit limit all decided on the device. The server is used exactly twice — pull the reference data, push the finished orders. There is a switch marked *Cut the connection*. [Open it →](https://mayouni.github.io/ringscript/samples/route-orders/) |

More will be added here. If you build one worth sharing, a pull request is
welcome.

## Running any of them

Any static server; the samples fetch their own files, so opening
`index.html` from the filesystem will not work.

```bash
# from the repository root
python -m http.server 8000
# then open http://localhost:8000/samples/<name>/
```

Each sample's own README says what it needs and what it demonstrates.

## Why the rules go in Ring at all

Because a rule that lives on the server stops working when the connection
does — and in a great deal of the world, and increasingly for clients who
want to know where their data sits, that is not an edge case.

Putting the rules on the device means writing them in a language that runs
there. RingScript makes that language Ring: readable enough that a colleague
who does not write code can check a rule against the policy, on a runtime of
~397 KB with no dependencies, [measured against Lua and
QuickJS](https://mayouni.github.io/ringscript/blog-measured-against.html) for
endurance and for JSON — the two things this kind of application actually
asks for.

The full argument, with the endpoints in detail:
**[Build the application on the device, not on the
network](https://mayouni.github.io/ringscript/blog-local-first-app.html)**.
