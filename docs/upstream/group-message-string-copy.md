**Status: DUPLICATE — Mansour had already sent this to the Google
Group.** Re-sent in error as PR
[#1648](https://github.com/ring-lang/ring/pull/1648), 2026-08-14, at
Mansour's direction — as a pull request rather than a group message,
since that is the channel Mahmoud has been answering on.

Re-measured on 1.27 the same day before sending: 20,000 `len()` calls cost
0.00 s on a 10-byte string and **4.91 s** on a 1 MB one. The reproduction
went with it as
`language/tests/scripts/performance/stringargument.ring`. Checked for
duplicates first — nothing upstream covers it; #1440 is a different
string-allocation fix.

The draft below is kept as written. The PR body is a tightened version of
it: same measurement, same three directions, same refusal to propose a
patch.

---

**Where:** the Ring Google Group (issues and discussions are both
disabled on ring-lang/ring, so this is the place for a design question).

**Subject:** A VM performance finding: string arguments are copied on every call

---

Hello Mahmoud, hello everyone,

While building a WebAssembly runtime on the Ring 1.27 VM, I ran into a
performance behaviour I think is worth sharing. Everything below is
measured on **stock `ring.exe` 1.27.0 on Windows** — it is not a
WebAssembly issue.

**The measurement.** Both loops below do the same work — 20,000 calls to
`len()`, which only reads a stored size. Only the size of the argument
differs:

```ring
cTiny = "0123456789"
cBig = "a"
while len(cBig) < 1048576 cBig += cBig end

t1 = clock()
nS = 0
for i = 1 to 20000 nS += len(cTiny) next
t2 = clock()
nS2 = 0
for i = 1 to 20000 nS2 += len(cBig) next
t3 = clock()
see "len(10 B) x 20k : " + ((t2-t1)/clockspersecond()*1000) + " ms" + nl
see "len(1 MB) x 20k : " + ((t3-t2)/clockspersecond()*1000) + " ms" + nl
```

Result: **1 ms vs about 4,900–5,000 ms** across four runs. Roughly 20 GB
was copied to answer 20,000 length queries.

**The cause** is `RING_VM_STACK_PUSHCVAR` in `vm.h`: passing a string
variable to a function copies the whole value onto the VM stack. That is
also what gives Ring its clean value semantics, so it is a trade-off
rather than a bug — but it means any Ring code that scans a large string
is O(length) per touch and O(n²) overall. Parsers, tokenizers, template
engines and text processing all inherit it. A JSON decoder written in
pure Ring reaches about 0.27 MB/s for this reason.

**Three possible directions**, in rising order of ambition:

1. Borrowed arguments for read-only builtins — `len()`, `ascii()`,
   `left()`, `right()`, `substr()`, `find()` never mutate or retain
   their string argument, so a flag at C-function registration could let
   PUSHCVAR pass a pointer for exactly those. Smallest change, and it
   covers the common cases.
2. Copy-on-write strings — reference-count the buffer, copy on write.
   Helps user-defined functions too, but needs care with the GC.
3. Reuse the existing `RING_OBJTYPE_SUBSTRING` machinery, which already
   expresses "a view into a string".

I am not proposing a patch — the trade-off is yours to weigh. But if any
of these directions interests you, I am glad to help: benchmarks, a test
corpus, or a prototype. I have a setup that runs Ring's own `samples/`
plus every runnable snippet in the documentation through a modified VM
and compares the output byte-for-byte against native `ring.exe`, which
makes changes like this safe to evaluate.

Best regards,
Mansour
