# The two features of PARTITION-FOUNDATIONS.md §2.4, written against the
# proposed v2 API and RUN -- this file is the gate's "compiles against the
# proposed API shape". Run from this folder, on stock Ring:
#
#     ring orders.ring
#
# The division of labour is the one both shipped samples prove: Ring decides,
# the library names and stores. Neither feature contains a network call, a
# retry, or an onLine check -- the default path IS the partition-tolerant path.

load "stub.ring"

# ------------------------------------------------------------- the state
aOrderId    = []
aOrderState = []          # received -> preparing -> ready -> collected
nPass = 0
nFail = 0

# ============================== the scenario, asserted ==================
# Mirrors §5's harness sketch: an outage, a cash order accepted, a card
# order refused by rule, the transition monotonic and idempotent, and every
# accepted decision queued durably (stub-counted) before any send exists.

# mid-outage (the stub pins rung = "unreachable")
r = OrderPlace([ :items = ["couscous royal"], :pay = "cash" ])
Check("cash order accepted while unreachable (P1)", r[:ok] = 1)
if r[:ok] = 1 PwaOutboxAdd(JsonEncode(r[:payload])) ok

r = OrderPlace([ :items = ["couscous royal"], :pay = "card" ])
Check("card order refused by rule while unreachable (P4)",
	r[:ok] = 0 and substr(r[:refuse], "card") > 0)

r = OrderPlace([ :items = [], :pay = "cash" ])
Check("empty order refused with a sentence, not a freeze (Law 5)",
	r[:ok] = 0 and len(r[:refuse]) > 0)

r = OrderMarkReady("loc-1")
Check("ready transition accepted while unreachable (Law 6 inverted)", r[:ok] = 1)
if r[:ok] = 1 PwaOutboxAdd(JsonEncode(r[:payload])) ok

r = OrderMarkReady("loc-1")
Check("re-pressing ready is idempotent, no rollback", r[:ok] = 1 and r[:already] = "ready")

Check("both decisions queued durably, nothing sent, nothing lost (Law 1)",
	PwaOutboxPending(1) = 2)

# the partition heals
PwaRungSet("streaming")
r = OrderPlace([ :items = ["the a la menthe"], :pay = "card" ])
Check("card order accepted once streaming", r[:ok] = 1)

see nl + "  " + nPass + " / " + (nPass + nFail) + " assertions hold." + nl
if nFail > 0 raise("EXAMPLE FAILED") ok

# ======================================================== the two features

# ---------------------------------------------------- feature 1: place
# The device decides ALONE (P1): validation and the payment rule consult no
# server. Card payment is never optimistic (P4): it needs a live authority,
# so any rung below "streaming" refuses it BY RULE, in Ring, where business
# rules live -- which is why the rung is pushed into the VM at all. A cash
# order is accepted on every rung, including alone.
func OrderPlace aIn
	aItems = aIn[:items]
	cPay   = aIn[:pay]
	if islist(aItems) = 0 or len(aItems) = 0
		return [ :ok = 0, :refuse = "an order needs at least one item" ]
	ok
	if cPay = "card" and PwaRung() != "streaming"
		return [ :ok = 0,
		         :refuse = "card payment needs the server -- pay cash, or wait" ]
	ok
	cId = "loc-" + (len(aOrderId) + 1)
	aOrderId + cId
	aOrderState + "received"
	return [ :ok = 1, :payload = [ :id = cId, :pay = cPay ] ]

# ------------------------------------------------ feature 2: mark ready
# Transitions are monotonic (P4): forward is legal on any rung and never
# rolls back -- Law 6's kitchen-blocking rollback is what this prevents. The
# transition is an intent handed to the outbox, not a fetch that can fail.
func OrderMarkReady cId
	nRow = OrderRowOf(cId)
	if nRow = 0
		return [ :ok = 0, :refuse = "no such order here" ]
	ok
	if OrderStateRank(aOrderState[nRow]) >= OrderStateRank("ready")
		return [ :ok = 1, :already = aOrderState[nRow] ]     # idempotent re-press
	ok
	aOrderState[nRow] = "ready"
	return [ :ok = 1, :payload = [ :id = cId, :to = "ready" ] ]

# --------------------------------------------------------------- helpers
func OrderRowOf cId
	return find(aOrderId, cId)

func OrderStateRank cState
	aRank = [ ["received",1], ["preparing",2], ["ready",3], ["collected",4] ]
	n = find(aRank, cState, 1)
	if n = 0 return 0 ok
	return aRank[n][2]

func Check cName, bOk
	if bOk
		see "  [ok] " + cName + nl
		nPass = nPass + 1
	else
		see "  [!!] " + cName + nl
		nFail = nFail + 1
	ok
