# What is next here

> ## Check this is still true before you answer from it
>
> **Generated 2026-08-16 19:42, when Central was at commit `17e88ad`.**
>
> This is a snapshot. The plan may have moved since, and a stale answer given
> confidently is worse than no answer. One command settles it, and it is cheap
> enough to run every time -- so run it every time, before you answer:
>
> ```
> powershell -ExecutionPolicy Bypass -File D:\GitHub\softanza\dashboard\central.ps1 -Install -Only ringscript
> ```
>
> It rewrites this file and nothing else in your repository. If nothing changed, git
> shows nothing and you have lost two seconds. **Then answer.**
>
> If it still does not answer your question -- the task is unclear, the order looks
> wrong, or your tree disagrees with it -- **ask Central directly** by appending a
> block to `D:\GitHub\softanza\mailbox\ringscript.md`. You have every right to; that
> channel exists for exactly this. Do not guess, and do not wait for permission.

The full cross-repository picture is in
## Facts, read when this was written

- Reference design: **v1.5** (from `REFERENCE_DESIGN.md`)
- The UI law: **v3.11, 122 rules** (from `stzzui/constitution/rules.json`)
- The placement contract: **v1.0** (from `contracts/placement.md`)

**Where a prompt disagrees with this repository, this repository is right.**

## Ready now, independent of everything else

### Swap the vendored VM for a patched Ring -- one swap, not six errands

*Session: RingScript session*

Six fixes landed in Ring after 1.27 that every vendored ringvm still lacks: private-in-eval, strtod/musl, memcpy zero-byte, empty-catch stack, name folding, operator overloading. RingScript and RingServ are both on unpatched 1.27; MicroRing already patches locally and tracks it correctly.

<details><summary>the prompt</summary>

```text
Your vendored ringvm is on unpatched Ring 1.27 and is missing six fixes that landed upstream after it: private-in-eval, strtod/musl, memcpy zero-byte, empty-catch stack, name folding, operator overloading.

Treat it as one swap rather than six errands: move to a patched base, run your oracle, and record what moved. MicroRing already does this correctly and is worth reading first.

RingServ is in the same position -- do not fix it from here; say so in your SESSION-LOG line so its own session picks it up.
```

</details>

## Held, with the reason

### Pin the grammar and review its placement row

*Session: RingScript session*

Two small pins, both gates cleared. Nothing depends on it, so it can wait for a quiet moment.

<details><summary>the prompt</summary>

```text
Read D:\GitHub\softanza\prompts\11-ringscript-pins.md and carry it out. Both preconditions are met: the grammar has its own home, and the placement contract was ratified on 2026-08-12.
```

</details>

## Talking back

Your mailbox is `D:\GitHub\softanza\mailbox\ringscript.md`. Open it now and keep it open --
that is what makes Central's appends arrive as messages.

Disagree by appending a `COUNTER` block **with the local fact Central cannot see**;
a preference is not a counter. Central answers with `ACCEPT` or `INSIST`; you then
`CLOSE`. Three messages, never a fourth, and you never counter twice. **If Central
does not answer, proceed and record what you did.**

Report conclusions -- not activity -- as one line in `softanza\dashboard\SESSION-LOG.md`.
