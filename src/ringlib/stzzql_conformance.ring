# stzZql conformance runner -- pure core Ring, no dependencies. Run from this dir:
#   ring stzzql_conformance.ring
#
# Drives the embedded engine (stzZql.ring, in this folder) against the 16
# verdicts published in D:\GitHub\stzzql\conformance\fixtures.json (the
# canonical grammar's "tontine conformance fixtures v1"). Every runtime in
# any language proves agreement against that file rather than asserting it
# -- this is RingScript's proof.
#
# The fixture source, case data and expected verdicts below are transcribed
# from fixtures.json by hand rather than parsed at runtime, because the
# engine this tests is deliberately pure core Ring with no JSON dependency
# and the runner follows the same discipline. If fixtures.json changes,
# this file is re-transcribed -- that manual step IS the re-pin.
#
# See docs/ZQL_PIN.md for the recorded pin (source commit, sha256, result).

load "stzZql.ring"

cSrc = '
DEFINE ENTITY deposit (
  id: uuid,
  member: text,
  amount: currency,
  round: int,
  status: enum("STAGED", "AUDITED", "ACTIVE")
) RATIONALE "One member' + char(39) + 's contribution to one round of the circle"

DEFINE NORM positive_deposit AS (
  RULE: amount > 0,
  MESSAGE: "A deposit must bring something to the circle"
)

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

DEFINE FLOW indice (
  STEP 1: SAISIE -> {
    ACTOR: collector,
    VALIDATE: COUNT(reponses) >= 1,
    ON_FAIL: REJECT "VIDE"
  },
  STEP 2: CALCUL -> {
    ACTOR: system,
    FORMULA: score = ROUND((SUM(reponses) / (COUNT(reponses) * 5)) * 100)
  },
  STEP 3: CONTROLE -> {
    ACTOR: treasurer,
    ENFORCING: indice_plafond,
    ON_SUCCESS: COMMIT_TO_BEDROCK
  }
) RATIONALE "The satisfaction survey computes its index in-flow"

DEFINE NORM indice_plafond AS (
  RULE: score >= 0 AND score <= 100,
  MESSAGE: "An index lives between 0 and 100"
)

DEFINE LANDING_ZONE cotisations AS JSON
  INTO collect
  RATIONALE "Deposits exported by the mobile collector land here; every record walks the flow"
'

nPass = 0
nFail = 0

o = StzZqlQ(cSrc)

# ------------------------------------------------------------- counts (4)
Check("1 entity parsed",  o.CountEntities() = 1)
Check("2 norms parsed",   o.CountNorms() = 2)
Check("2 flows parsed",   o.CountFlows() = 2)
Check("1 zone parsed",    len(o.@aZones) = 1)

see nl + "norm cases (4)" + nl

# ------------------------------------------------------------ norm cases
Check("one franc counts",
	o.EvalNorm("positive_deposit", [ :amount = 1 ]) = true)
Check("five thousand holds",
	o.EvalNorm("positive_deposit", [ :amount = 5000 ]) = true)
Check("zero violates",
	o.EvalNorm("positive_deposit", [ :amount = 0 ]) = false)
Check("negative violates",
	o.EvalNorm("positive_deposit", [ :amount = -30 ]) = false)

see nl + "flow cases (8)" + nl

# ------------------------------------------------------------ flow cases
r = o.RunFlow("collect", [ :member = "Aminata", :amount = 5000, :round = 1 ])
Check("a valid deposit completes", r[:status] = "complete")

r = o.RunFlow("collect", [ :member = "", :amount = 5000, :round = 1 ])
Check("nameless deposit rejected at RECORD",
	r[:status] = "failed" and r[:failedstep] = "RECORD")

r = o.RunFlow("collect", [ :member = "Sanda", :amount = 0, :round = 1 ])
Check("empty-handed deposit halted at AUDIT",
	r[:status] = "failed" and r[:failedstep] = "AUDIT")

r = o.RunFlow("collect", [ :member = "Moussa", :amount = 0, :round = 2 ])
Check("boundary: exactly zero is not positive",
	r[:status] = "failed" and r[:failedstep] = "AUDIT")

r = o.RunFlow("collect", [ :member = "Fatima", :amount = "7500", :round = 2 ])
Check("numeric string amount coerces", r[:status] = "complete")

r = o.RunFlow("indice", [ :reponses = [4, 5, 3, 4, 5] ])
Check("FORMULA: [4,5,3,4,5] computes 84 and completes",
	r[:status] = "complete" and o.EvalNorm("indice_plafond", [ :score = 84 ]) = true)

r = o.RunFlow("indice", [ :reponses = [5, 5, 5] ])
Check("FORMULA boundary: all fives compute exactly 100",
	r[:status] = "complete" and o.EvalNorm("indice_plafond", [ :score = 100 ]) = true)

r = o.RunFlow("indice", [ :reponses = [] ])
Check("FORMULA: an empty survey is refused before computing",
	r[:status] = "failed" and r[:failedstep] = "SAISIE")

see nl + "rejects (4) -- the closed verb set" + nl

# --------------------------------------------------------------- rejects
CheckRejects("DROP TABLE users")
CheckRejects("DELETE FROM deposit")
CheckRejects("TRUNCATE deposit")
CheckRejects('DEFINE VIRUS x ( a: int )')

see nl + "  " + nPass + " / " + (nPass + nFail) + " verdicts agree." + nl
if nFail > 0
	raise("CONFORMANCE FAILED -- " + nFail + " verdict(s) disagree with fixtures.json")
ok

func Check(cName, bOk)
	if bOk
		see "  [ok] " + cName + nl
		nPass = nPass + 1
	else
		see "  [!!] " + cName + nl
		nFail = nFail + 1
	ok

func CheckRejects(cBad)
	bClosed = 0
	try
		StzZqlQ(cBad)
	catch
		bClosed = 1
	done
	Check(cBad + " -- unparseable", bClosed)
