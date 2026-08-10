# Upstream material for ring-lang/ring

Findings from RingScript prepared for the Ring project, plus what
happened to each. **Checked against the live repository on August 7,
2026 — before any of it was sent** — which changed the picture
considerably. Read this before posting anything. Re-checked August 10 for
item 5.

## The channel — settled, and not a judgement call

**Findings go to the Ring Google Group, and Mansour posts them himself.**
No pull requests on `ring-lang/ring`, and nothing else filed there
directly. Decided 2026-08-10; it does not expire and it is not reopened by
a finding that feels important enough.

What this repository does is prepare the text: the finding, a reproduction
that runs on stock Ring, and the measurements. Draft it here, show it, and
stop. Write it as **plain text** — the group does not render markdown.

The reason is not technical. The conversation with the Ring project is
Mansour's, in his voice, and it is not for an assistant to conduct. See the
note under item 5 for what happened when that line was crossed.

## Two further facts about the channel

- **`ring-lang/ring` has issues disabled** (`has_issues: false`), and
  **Discussions are disabled too**. There is no tracker. The only
  channels are **pull requests** and the **Ring Google Group**.
- Mahmoud develops Ring through **PWCT**, so C patches are generally
  reimplemented there rather than merged as-is. That shapes what is
  worth sending: a *finding* travels better than a *patch*.

## Status of each item

| | item | status | do not / do |
|---|---|---|---|
| 1 | [private + eval crash](issue-1-private-eval-crash.md) | **already delivered** as PR [#1639](https://github.com/ring-lang/ring/pull/1639); closed Aug 2 with "I will revise/fix them using PWCT in the future" | **do not refile** |
| 2 | [strtod errno on musl](issue-2-strtod-musl-errno.md) | same PR, same reply | **do not refile** |
| 3 | [string argument copy](discussion-3-string-argument-copy.md) | **not sent, and the one genuinely new finding** | send as [a Google Group message](group-message-string-copy.md) |
| 4 | [computed-goto](offer-4-computed-goto.md) | **obsolete — withdraw** | **do not send** |
| 5 | [list random access + sort by column, both O(n²)](proposal-5-list-random-access.md) | **merged** as PR [#1642](https://github.com/ring-lang/ring/pull/1642), Aug 10 — but only the `sort()` half. Mahmoud rejected the accessor change with reasons that measured out correct (see below), and merged the rest himself. **The last PR to this project**: see the channel note above. Reproduced on stock Ring **1.27**; framed as a finding, with the diff offered as illustration since Ring is authored in PWCT | **do not refile** |

### Why item 4 is obsolete

The draft offers to write `ring_vm_computedgoto()` because `vm.h`
declares it and `vm.c` carries the comment *"The next function must be
written if RING_VM_COMPUTEDGOTO is enabled"*. **Ring already has it**:
`language/build/vmcgoto/vmcgoto.c` (11 KB, GCC-only, designated-
initializer dispatch table), and PR
[#1636](https://github.com/ring-lang/ring/pull/1636) added a
`RING_COMPUTED_GOTO` CMake option to build with it.

The vendored tree in this repository contains only `language/include`
and `language/src`, not `language/build/` — which is why the
declaration and that comment looked like an open invitation. They are
not. RingScript's own implementation
([VENDOR_PATCHES.md](../VENDOR_PATCHES.md) patch 5) is still needed
*here*, because it covers all 121 opcodes and compiles under
clang-for-wasm, but it is a variation on existing work, not a
contribution.

The file is kept for the record, not for sending.

### Items 1 and 2

Both were delivered together in #1639 and acknowledged. Refiling five
days later would re-raise something already seen and consciously
deferred — pressure rather than help, and it would spend goodwill
better saved for item 3.

If anything is worth adding, it is a short friendly comment on #1639
with the one fact that PR did not carry: both fixes have since run
byte-exact across ~850 programs (Ring's `samples/` plus every runnable
documentation snippet), so a verification corpus is available whenever
the PWCT reimplementation happens. Additive, not nagging.

### Item 3 — the one to send

The string-argument copy is new, measured on **stock native
`ring.exe`** (not wasm), and it is a design question rather than a bug —
which is exactly what a mailing list is for, and what the absent issue
tracker cannot hold.

Use **[group-message-string-copy.md](group-message-string-copy.md)** —
the message, with subject line, written for the group. The longer
[discussion-3-string-argument-copy.md](discussion-3-string-argument-copy.md)
is the fuller version, useful if the conversation goes deeper or if it
ever becomes a PR body.

## If a maintainer asks for more

- **Reproductions** — every `ring` snippet in these files runs as-is on
  stock Ring; all were extracted and executed against `ring.exe`
  1.27.0 before being written down.
- **The verification corpus** — `tests/samples-sweep.js` runs Ring's
  `samples/` and the documentation snippets through both a modified VM
  and native `ring.exe`, comparing byte-for-byte.
- **Everything in one place** — [UPSTREAM_CASE.md](../UPSTREAM_CASE.md).
