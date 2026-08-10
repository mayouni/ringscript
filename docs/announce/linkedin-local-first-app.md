# LinkedIn post — the local-first argument, for developers on any back end

Written to be posted **with a screenshot of a real application** — the
client-visit app running at a bank in Niger, with its "Hors ligne" badge
visible. The image carries the proof; the words only have to frame it.

---

That badge in the corner says **Hors ligne**. The application doesn't care.

This is a client-visit app running at a bank in Niger. The agent's list,
the filters, the statuses, the rules — all of it works with no signal. When
the connection comes back, it synchronises. That's not a feature we added
at the end. It's the architecture.

Here's what I'd put to developers anywhere: **local-first isn't a
nice-to-have.** For most of the world it's a requirement, and everywhere
else clients are starting to ask who actually holds their data. Both
questions have the same answer.

The obstacle is usually the front end: the rules have to run where the work
happens, and that means writing them in a language that runs there.

So I built **RingScript** — the Ring language compiled to WebAssembly,
running in the browser. Your screens stay **plain HTML and CSS**. Your
JavaScript keeps doing what it does: fetch, storage, the DOM. What moves to
Ring is the part that decides things — pricing, limits, validation, the data
processing — because it is readable enough that a colleague who does not
write code can check a rule against the policy.

And **your back end stays exactly where it is**: Django, Laravel, Spring,
Node, Go. It only ever sees JSON.

A working sample you can cut the connection on, plus the two HTTP endpoints
it needs:
https://mayouni.github.io/ringscript/blog-local-first-app.html

#LocalFirst #OfflineFirst #WebAssembly

---

## Notes on why it is shaped this way

- **The screenshot is the argument.** The first two lines only work because
  the image is there — they point at it rather than describing it.
- **It leads with a real deployment, not with the runtime.** A developer
  scrolling past stops for a production application at a bank, not for a
  language announcement.
- **The reassurance is explicit and early.** "Your back end stays exactly
  where it is" is the sentence that decides whether a Django or Spring
  developer keeps reading, so it is not left to the article.
- **It does not overclaim.** Ring is for the business logic and the data
  processing. The screens are HTML and CSS, and saying so is what makes a
  front-end developer trust the rest of the post.
- **One link, not two.** The article carries the sample, the endpoints and
  the measurements; sending people to two places splits the click.
