# tickets.ring -- what the café MEANS.
#
# The whole tutorial in one sentence: the rules live here, in Ring, on the
# device, and they keep working when the network does not. No DOM, no
# fetch, no storage in this file -- app.js wires the browser, the
# ringscript-pwa library owns the queue, and this file only decides things.

aTkId    = []
aTkTable = []
aTkItem  = []
aTkState = []          # placed -> served
nTkSeq   = 0

# ------------------------------------------------------- place a ticket
# The device decides ALONE. Taking an order needs no server -- that is the
# point of the whole architecture: a waiter's hand does not stop writing
# because the router rebooted.
func TicketPlace pIn
	# an object from ring.call arrives already decoded; a JSON string
	# (native tests, other Ring code) still parses
	aIn = pIn
	if isstring(pIn)
		aIn = JsonDecode(pIn)
	ok
	nTable = 0
	cItem = ""
	for i = 1 to len(aIn)
		if aIn[i][1] = "table"  nTable = 0 + aIn[i][2]      ok
		if aIn[i][1] = "item"   cItem = "" + aIn[i][2]      ok
	next
	if nTable < 1 or nTable > 20
		return JsonEncode([ :ok = 0, :refuse = "tables run 1 to 20" ])
	ok
	if len(cItem) = 0
		return JsonEncode([ :ok = 0, :refuse = "a ticket needs an item" ])
	ok
	nTkSeq = nTkSeq + 1
	cId = "t-" + nTkSeq
	aTkId + cId
	aTkTable + nTable
	aTkItem + cItem
	aTkState + "placed"
	return JsonEncode([ :ok = 1,
		:payload = [ :id = cId, :table = nTable, :item = cItem ] ])

# ------------------------------------------------------- serve a ticket
# Monotonic, on every rung. Serving food never rolls back because a
# request failed -- the plate already left the kitchen.
func TicketServe cId
	n = find(aTkId, cId)
	if n = 0
		return JsonEncode([ :ok = 0, :refuse = "no such ticket" ])
	ok
	aTkState[n] = "served"
	return JsonEncode([ :ok = 1, :payload = [ :id = cId, :to = "served" ] ])

# ------------------------------------------------------ cancel a ticket
# THE RUNG RULE -- the one this tutorial exists to show. A cancellation
# touches the till's totals, so it needs the till reachable; the library
# maintains the rung and pushes it into Ring, so the refusal is a business
# rule HERE, not an if-statement in UI code.
func TicketCancel cId
	if PwaRung(1) != "streaming"
		return JsonEncode([ :ok = 0,
			:refuse = "a cancellation needs the till -- it will be possible again when the connection returns" ])
	ok
	n = find(aTkId, cId)
	if n = 0
		return JsonEncode([ :ok = 0, :refuse = "no such ticket" ])
	ok
	aTkState[n] = "cancelled"
	return JsonEncode([ :ok = 1, :payload = [ :id = cId, :to = "cancelled" ] ])

# ------------------------------------------------------------------ read
func TicketList p
	aOut = []
	for i = 1 to len(aTkId)
		aOut + [ :id = aTkId[i], :table = aTkTable[i],
		         :item = aTkItem[i], :state = aTkState[i] ]
	next
	return JsonEncode(aOut)
