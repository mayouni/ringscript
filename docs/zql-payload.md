# The ZQL payload — a library baked into the runtime

*Goal of this page: what `stzZql.ring` is, why it ships inside the wasm, and
the grammar it accepts — as the Ring implementation actually parses it.*

This is the sixth document. It assumes [Architecture](architecture.md).

## 1. Why a grammar engine is in here at all

RingScript embeds two pure-Ring libraries in the wasm: `json.ring`, which the
bridge needs, and **`stzZql.ring`**, which it does not. The second one is a
**worked example of the embedded-library seam** — proof that a real
multi-hundred-line Ring library, written for a filesystem, runs unchanged in a
browser with no filesystem at all.

It earns that role by being demanding: a hand-written tokenizer, a recursive
descent parser, an expression evaluator and a small interpreter, in **pure core
Ring** — no `stdlib`, no `stzlib`. If it works, the seam works.

ZQL itself belongs to **StzWeb**, where the same closed grammar has three
implementations — a Zig CLI, a JavaScript runtime, and this Ring one. *One
grammar, three runtimes.* This page documents the Ring one, which is what
RingScript ships.

```ring
load "ringlib/stzZql.ring"          # resolves against the embedded map
o = StzZqlQ('DEFINE ENTITY deposit (id: uuid) RATIONALE "one contribution"')
? o.CountEntities()                 # 1
```

## 2. Bare names, not sigils

Names and field references are **bare identifiers**. A leading `:` is a syntax
error:

```ring
DEFINE ENTITY deposit ( ... )       # correct
DEFINE ENTITY :deposit ( ... )      # stzZql (line 1): Expected ident but found ':'
```

The colon keeps exactly one job — separating a key from its value
(`RULE:`, `ACTOR:`, `id: uuid`). Worth stating plainly because Ring's own
pair-lists *do* use atoms, and the two sit side by side when you call a flow:

```ring
aData = [ :member = "Aminata", :amount = 5000 ]   # Ring pair-list — atoms
aResult = o.RunFlow("collect", aData)             # ZQL name — bare
```

## 3. The grammar

A program is a sequence of `DEFINE` declarations and nothing else. There are
four, and the set is closed — see §5.

```
program      := { "DEFINE" declaration }
declaration  := ENTITY | NORM | FLOW | LANDING_ZONE
```

### ENTITY — the shape of a thing

```
ENTITY name "(" field { "," field } ")" [ RATIONALE string ]
field        := name ":" type [ "(" arg { "," arg } ")" ]
```

```ring
DEFINE ENTITY deposit (
  id: uuid,
  member: text,
  amount: currency,
  round: int,
  status: enum("STAGED", "AUDITED", "ACTIVE")
) RATIONALE "One member contribution to one round of the circle"
```

Type names are not checked against a list — `uuid`, `text`, `currency`, `int`
are conventions, and a type may take arguments, as `enum` does.

### NORM — a rule with a sentence

```
NORM name "AS" "(" "RULE" ":" expr "," "MESSAGE" ":" string ")"
```

```ring
DEFINE NORM positive_deposit AS (
  RULE: amount > 0,
  MESSAGE: "A deposit must bring something to the circle"
)
```

The message is not decoration: when a norm stops a flow, that sentence is what
the outcome carries back.

### FLOW — ordered steps, each with an actor

```
FLOW name "(" step { "," step } ")" [ RATIONALE string ]
step     := "STEP" number ":" name "->" "{" property { "," property } "}"
property := "ACTOR"      ":" name
          | "VALIDATE"   ":" expr
          | "FORMULA"    ":" field "=" arithmetic
          | "ENFORCING"  ":" norm-name
          | "ON_FAIL"    ":" verb [ string ]
          | "ON_SUCCESS" ":" verb [ string ]
```

```ring
DEFINE FLOW collect (
  STEP 1: RECORD -> {
    ACTOR: collector,
    VALIDATE: member != "",
    ON_FAIL: REJECT "NO_MEMBER"
  },
  STEP 2: AUDIT -> {
    ACTOR: treasurer,
    ENFORCING: positive_deposit,
    ON_SUCCESS: COMMIT_TO_BEDROCK
  }
) RATIONALE "The collector records; the treasurer audits"
```

Any other property name is rejected by name. `ON_SUCCESS: COMMIT_TO_BEDROCK`
is the one verb the engine acts on itself — it marks the flow committed.

### LANDING_ZONE — the only way data may arrive

```
LANDING_ZONE name "AS" format "INTO" flow-name [ RATIONALE string ]
```

```ring
DEFINE LANDING_ZONE monthly_import AS JSON INTO collect
  RATIONALE "Bulk contributions still pass every step"
```

`JSON` is the only format accepted today; anything else is refused as outside
the grammar. `INTO` is **mandatory** — an import must name the flow it feeds,
so bulk data cannot bypass the steps that guard single records.

### Expressions

```
expr    := term { "OR" term }
term    := factor { "AND" factor }
factor  := "(" expr ")" | operand op operand
op      := "=" | "!=" | ">" | "<" | ">=" | "<=" | "==" | "CONTAINS"
operand := number | string | true | false | field | AGG "(" field ")"
AGG     := SUM | COUNT | AVG | MIN | MAX
```

Arithmetic, used by `FORMULA`, is separate and conventional:

```
aexpr   := aterm { ("+" | "-") aterm }
aterm   := afactor { ("*" | "/") afactor }
afactor := "(" aexpr ")" | "ROUND" "(" aexpr ")" | number | field | AGG "(" field ")"
```

## 4. The Ring surface

```ring
o = StzZqlQ(cSource)          # parses, or raises "stzZql (line N): ..."

o.CountEntities()  o.CountNorms()  o.CountFlows()  o.CountZones()
o.EntityRationale(cName)   o.NormMessage(cName)   o.FlowRationale(cName)
o.Describe()                  # every declaration, plus the norm links

o.EvalNorm(cName, aData)      # aData is a Ring pair-list -> 1 or 0
o.RunFlow(cName, aData)       # -> pair-list, keys below
```

`Describe()` reads back in the same vocabulary you wrote — bare names, no
sigils, so what it prints can be pasted back into a declaration:

```
entity deposit (3 fields) -- one contribution
norm positive_deposit -- "A deposit must bring something to the circle"
flow collect (2 steps) -- The collector records; the treasurer audits
zone monthly_import (JSON into collect) -- Bulk contributions still pass every step
link: flow collect step AUDIT ENFORCING norm positive_deposit
```

`RunFlow` returns `status` (`"complete"` or `"failed"`), `failedstep`,
`actionverb`, `actionarg`, `committed` (`1`/`0`), and `outcomes` — a list of
`[name, actor, ok, reason]`, one per step.

Because the result is a pair-list, it crosses to JavaScript as JSON with no
extra work:

```js
const r = ring.call("RunCollect", { member: "", amount: 5000 });
r.result.status;      // "failed"
r.result.actionarg;   // "NO_MEMBER"
```

Parse failures `raise()`, so wrap them the way you would any Ring error —
[errors never take the page down](api.md).

## 5. The verb set is closed, by construction

There is no `DROP`, no `DELETE`, no `UPDATE` — and not because they are
blocked. They are simply **not in the grammar**, so they cannot be expressed:

```ring
StzZqlQ("DROP TABLE users")
# stzZql (line 1): Unknown verb 'DROP'. The ZQL verb set is closed --
# destructive or unrecognized operations are not part of the grammar.
```

A closed grammar is a stronger guarantee than a permission check, and it is
the property that makes running it inside a browser reasonable at all.

## 6. Where it is verified

`src/ringlib/stzzql_smoke.ring` is a 10-assertion suite that ships embedded
beside the engine and runs **inside the wasm** as gate P3 — it parses the
declarations above, evaluates a norm both ways, runs a flow to completion, has
one rejected at `RECORD` and one stopped at `AUDIT` by its norm, and confirms
`DROP` is unparseable. Two further P3 gates check that `Describe()` lists every
declaration kind, zones included, and emits no sigils. Gate P4 then calls a
flow through `ring.call()` and
checks the result arrives as JSON.

```bash
node tests/gates.js          # P3 (embedded payload) and P4 (bridge)
```
