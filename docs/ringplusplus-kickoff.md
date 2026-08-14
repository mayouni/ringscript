# Ring++ — kickoff prompt for a dedicated session

*Paste the block below into a fresh session. It is written to be
self-contained: it names the real sources, the real function surface, and
the constraints, so the session can start from facts rather than from
guesses.*

> **Stage one is already done** (2026-08-14) and its results are in
> [`ringplusplus-findings.md`](ringplusplus-findings.md). The prompt below
> now sends the new session straight to the design and tells it to read
> those findings first rather than rediscover them. One of them overturns
> the premise the prompt was originally written on, so do not skip it.

---

## The prompt

> **Design Ring++.**
>
> I am Mansour Ayouni — creator of the Softanza library for Ring, of
> RingScript (the Ring VM compiled to WebAssembly), and of business
> applications running in a bank and a school in Niger and a restaurant in
> France. I want you to design a project called **Ring++**, and in this
> session I want a *design*, not code.
>
> ### The idea in one paragraph
>
> Ring has a large low-level surface that Mahmoud Fayed built over the
> years — raw pointers, byte packing, memory copying, VM introspection,
> tracing, an entire embedding API — and almost no Ring programmer uses
> any of it, because it is undocumented in practice, unsafe by nature, and
> reads like C wearing Ring's syntax. **Ring++ is the high-level, simple,
> safe way into that surface.** A programmer writes ordinary Ring; when
> they hit a wall — a hot loop, a big buffer, a parser, a codec — they
> reach for Ring++ *in the same file, in the same project*, and get the
> performance without leaving the Ring world for C or an extension.
>
> ### The target experience
>
> This is the feel I am after. Treat it as a sketch of intent, not as an
> API to implement literally:
>
> ```ring
> load "ringplusplus.ring"
>
> # ordinary Ring, unchanged
> aRows = LoadTheRows()
>
> # ...and where it matters, drop a level without leaving the language
> oBuf = RppBuffer(1024 * 1024)         # a real, sized buffer
> oBuf.WriteInt32(0, len(aRows))
> oBuf.CopyFrom(cSourceString, 4)
>
> RppFastIndex(aRows)                   # honest name for what it does
> nTotal = RppSumColumn(aRows, 4)
> ```
>
> Three properties matter more than any particular function:
>
> 1. **One project, two altitudes.** No separate build, no extension to
>    compile, no second language. `load` and go.
> 2. **The escape hatch is visible.** A reader can see exactly where the
>    program leaves safe ground, and why.
> 3. **Nothing is invented.** Every Ring++ facility rests on something
>    Mahmoud already built. If Ring cannot do it, Ring++ does not pretend
>    it can.
>
> ### Study these three, in this order, before proposing anything
>
> **1. The Ring VM itself — the primary source.**
> The documentation is thin here; the code is the truth. A Ring 1.27 tree
> is at `D:\ring127` (the interpreter is `D:\ring127\bin\ring.exe`).
> A vendored 1.27 source tree, with build tooling and a byte-exact oracle
> already around it, is at `D:\GitHub\ringscript\ringvm\`.
>
> Read, at minimum: `rlist.c` (lists, the cursor, the items array),
> `vmgc.c` (the pool manager and what `ring_state_free` really costs),
> `rstring.c`, `vmmem.c`, `vminfo_e.c` (what is exposed and how),
> `state.c`, and `include/rlist.h` / `include/vmgc.h`.
>
> **Take Mahmoud's position while reading.** Ask what he was optimising
> for and what he deliberately did not do. Do not treat anything as a
> mistake until you have measured it. Your goal is to *use* his design,
> never to fight it.
>
> **2. `ringpackages/myctiger` — his own abandoned attempt at this
> territory.** *"Use the Ring programming language for generating and
> building C programs (Prototype of the idea)"*, started Oct 2025, last
> touched Dec 2025. Ring as a **compile-time meta-language for C**:
> `Tiger { ... }` blocks using Ring's brace magic, strings become
> `printf`, `` C `...` `` injects raw C, TCC ships in `tools/`, output is
> a `.c` and an `.exe`.
>
> Read it and answer honestly: what did it get right, why do you think it
> stopped, and is code generation the right shape for Ring++ or a
> different project? I lean toward Ring++ living *inside* the running VM,
> with generation as a possible later escape hatch — but argue it, do not
> assume it.
>
> **3. Softanza's System module — my own prior art on the same problem.**
> `D:\GitHub\stzlib\libraries\stzlib\base\system\` — about 11,000 lines
> across `stzPointer.ring`, `stzMemoryConvertors.ring`,
> `stzMemoryProfiler*.ring`, `stzSystemCall.ring`, `stzOperatingSystem.ring`,
> `stzProcess.ring`, `stzVirtualSystem.ring`, `stzBuilder.ring`,
> `stzDelivery.ring` and others.
>
> This is where I already tried to make system programming legible to
> high-level programmers. Study the *style*: a `stz` class over a `stk`
> core, `...Q()` constructors, short aliases beside long names, named
> constants instead of magic numbers. Decide what Ring++ should inherit
> from it and what it should do differently — and whether Ring++ should be
> independent of Softanza or a layer within it. I want a recommendation.
>
> ### The raw material that already exists
>
> Ring registers all of this today. Group it, judge it, and decide what
> Ring++ surfaces, what it wraps, and what it deliberately hides:
>
> - **Pointers and memory** — `varptr`, `getptr`/`setptr`, `nullptr`,
>   `ptrcmp`, `obj2ptr`/`ptr2obj`, `ptr2str`, `memcpy`, `space`, `ref`,
>   `refcount`, `callgc`
> - **Bytes and packing** — `int2bytes`/`bytes2int`,
>   `float2bytes`/`bytes2float`, `double2bytes`/`bytes2double`, `bytes`,
>   `str2hex`/`hex2str`, `murmur3hash`
> - **VM introspection** — `ringvm_cfunctionslist`, `ringvm_functionslist`,
>   `ringvm_classeslist`, `ringvm_packageslist`, `ringvm_memorylist`,
>   `ringvm_calllist`, `ringvm_codelist`, `ringvm_scopescount`,
>   `ringvm_ismempool`, `ringvm_info`
> - **VM control** — `ringvm_callfunc`, `ringvm_evalinscope`,
>   `ringvm_runcode`, `ringvm_runcodeatins`, `ringvm_settrace`,
>   `ringvm_tracedata`/`traceevent`/`tracefunc`, `ringvm_passerror`,
>   `ringvm_hideerrormsg`, **`ringvm_genarray`**
> - **A whole embedding API, exposed to Ring itself** — the
>   `ring_state_*` family: `new`, `init`, `delete`, `runcode`, `runfile`,
>   `runobjectfile`, `runcodeatins`, `findvar`, `newvar`, `setvar`,
>   `filetokens`, `stringtokens`, `scannererror`, `resume`
> - **Compilation and object files** — `ringvm_writeringo`,
>   `ringvm_translatecfunction`, `ringvm_ringolists`, `loadlib`/`closelib`
> - **System** — `sysget`/`sysset`/`sysunset`, `nofprocessors`, `getarch`,
>   `uptime`, `system`
>
> `ring_state_*` being callable *from Ring* is the most under-used thing
> on that list. Think about what it makes possible.
>
> ### The design principle I learned the hard way, today
>
> I proposed two VM changes to Mahmoud. He accepted one and rejected the
> other, and his reasons were right in a way I could not see from my own
> measurements:
>
> - creating an items array has a cost of its own;
> - a program that *mixes* adding and reading would create and delete it
>   over and over;
> - Ring's memory pool checks, on every free, whether a pointer belongs to
>   such an array — so many of them make **every free in the program**
>   slower;
> - **you cannot measure one access pattern and generalise from it.**
>
> He also named the failure mode: this is a common shape of mistake in
> generated code — solving the stated problem without seeing what else it
> touches. When I built two runtimes differing only in that change, he was
> right: **1.7–2.3× slower** on mixed add/read, widening with size, against
> a large win on read-heavy work. My 850-program byte-exact corpus never
> caught it, because that corpus proves *correctness* and says nothing
> about a performance regression on a pattern none of its programs uses.
>
> And the answer was already in the language: **`ringvm_genarray()`** —
> opt-in, explicit, at the call site. On an unpatched build it took a
> permuted read of 80,000 items from 962 ms to 20.6 ms.
>
> **That is the whole philosophy of Ring++ in one story.** The power was
> already there. What was missing was a way to reach it that is explicit,
> local, and obvious in the code. Ring++ should be a hundred
> `ringvm_genarray`-shaped decisions: *the programmer says when*, the
> library makes saying it pleasant and safe.
>
> ### Hard constraints
>
> 1. **Never fight the VM.** No forks of Ring semantics, no shadow
>    allocator, no clever global interception. If a facility needs a VM
>    change, that is a finding to report — not a thing Ring++ does behind
>    the language's back.
> 2. **It must survive Ring upgrades untouched.** Every new Ring release
>    should work with no disruption. Design for that explicitly: a thin,
>    declared compatibility surface; a conformance suite that tells you in
>    minutes whether a new Ring still satisfies Ring++'s assumptions;
>    version detection with honest degradation rather than breakage. Say
>    what happens when a function it relies on changes.
> 3. **Zig is the ally for packaging.** No dependency the user must
>    install: one `build.zig` producing what is needed on every platform,
>    the way RingScript does it (`D:\GitHub\ringscript\build.zig` — one
>    toolchain, no `build.zig.zon`, nothing fetched at build time).
>    Consider how far this goes: vendored builds, native extensions
>    without an SDK, executable generation.
> 4. **Measure, never assume.** Any performance claim needs an A/B on two
>    builds or two code paths differing in exactly one thing, on **Ring
>    1.27** (`D:\ring127\bin\ring.exe` — *not* the 1.26 install, which has
>    its own pathologies). Include the pattern that would be *hurt* by
>    each proposal, not just the one that is helped.
> 5. **Never open a pull request or an issue on `ring-lang/ring`.**
>    Findings go to the Ring Google Group, and I post them myself. Prepare
>    the text; do not send it.
>
> ### What I want out of this session
>
> A design document I can act on, in the repository, covering:
>
> 1. **What Ring++ is** — a library, a vendored Ring, or something else —
>    with the reasoning and the alternatives you rejected.
> 2. **The layer map** — what sits on what, and where the boundary is
>    between "ordinary Ring" and "Ring++".
> 3. **The surface** — the facilities, named and grouped, each traced to
>    the Ring primitive it rests on. Mark anything that needs a VM change
>    as a *finding*, separately.
> 4. **The safety story** — this is pointer territory. What can crash,
>    what Ring++ prevents, what it cannot, and how failures are reported.
> 5. **The upgrade story** — how it survives Ring 1.28 and 1.35.
> 6. **The Zig build** — what is produced, on which platforms, with what
>    installed.
> 7. **Phases with gates** — each phase ending in something runnable and
>    verifiable, the way `docs/REPAIR_PLAN.md` and `docs/HEADROOM_PLAN.md`
>    in the RingScript repository are written. Read those two first for the
>    house style: a plan is not done until its gate runs.
> 8. **The honest risks** — what could make this a bad idea, and what
>    would make me abandon it.
>
> ### Start here — the reading is already done
>
> **Read `docs/ringplusplus-findings.md` in the RingScript repository
> before anything else.** A previous session did the source study and
> measured it. Four of its results change what you would otherwise design:
>
> 1. **The premise above is wrong, and the measurements say so.** Ring++ is
>    not a pointer and buffer library. An empty Ring `for` loop already
>    costs ~17 ns an iteration, and `list(n)` — which uses a bulk two-`calloc`
>    path — is exactly as fast as appending in a loop, because allocation is
>    not where the time goes. The interpreter loop is the floor. Moving one
>    identical scan from Ring into C measured **23.5×–26.9×**. So Ring++ is
>    **a catalogue of removed iterations**; the pointer surface is an
>    implementation detail, not the product.
> 2. **The memory pool is a one-shot arena.** Classes of 48/256/512 bytes,
>    one block each, allocated once per state and never again. Over 512
>    bytes is never pooled; an exhausted level falls to `malloc` forever.
>    Allocate few and large, or small and pooled — never many medium.
> 3. **`ring_state_registerblock()`** is the sanctioned way to hand Ring a
>    foreign range, and every non-pool free walks the registered list — so
>    registrations must be few, large and long-lived.
> 4. **The safety model already exists and is implemented**: 2,018 lines of
>    `stkMemory` / `stkBuffer` / `stkPointer` in Softanza, a borrow model
>    with many readers or one writer, views, and automatic invalidation.
>    Adopt it. Do not design a rival. Note that its ownership rule and the
>    VM's registration rule are the same constraint reached from opposite
>    directions.
>
> Then produce the design. If you believe any of those four findings is
> wrong, say so and re-measure it rather than quietly designing around it —
> but do not repeat the study for its own sake.
>
> ### How to work
>
> Read before proposing. Measure before claiming. When you are unsure what
> Mahmoud intended, look at what the code does under load rather than at
> what the name suggests. Tell me what you do not know.
>
> I would rather have a plan that rests on measurements than one that reads
> well and rests on air.

---

## Two things to hand the session yourself

**Point the session at the RingScript repository** (`D:\GitHubingscript`)
so it can actually read `docs/ringplusplus-findings.md`. Without that the
prompt above references a file it cannot open.

**The Google Group thread** you mentioned —
<https://groups.google.com/g/ring-lang/c/kHAlmVcP1tU> — cannot be fetched
programmatically (Groups needs a logged-in browser). Open it and paste the
content into the session, or say it is not essential.

**Anything from the bank or school applications** that shaped what you want
from Ring++ — a hot path that forced a workaround, a place you wished for a
buffer or a real array. Concrete pain is the best input a design like this
can get, and it is the one thing no amount of source reading will supply.
