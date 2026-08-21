# The world under partition test -- the §2.4 features, running against the
# REAL v2 library rather than a stub. Ring decides; the library names and
# stores. Neither feature contains a network call.

aWOrderId    = []
aWOrderState = []          # received -> preparing -> ready -> collected
aWGhosts     = []

# ---------------------------------------------------- feature 1: place
# The device decides alone (P1). Card payment is never optimistic (P4): it
# needs a live authority, so any rung below "streaming" refuses it BY RULE,
# read from the library's own PwaRung.
func WOrderPlace cJson
	aIn = JsonDecode(cJson)
	cId = ""  cPay = ""
	for i = 1 to len(aIn)
		if aIn[i][1] = "id"   cId  = "" + aIn[i][2]  ok
		if aIn[i][1] = "pay"  cPay = "" + aIn[i][2]  ok
	next
	if len(cId) = 0
		return JsonEncode([ :ok = 0, :refuse = "an order needs an id" ])
	ok
	if cPay = "card" and PwaRung(1) != "streaming"
		return JsonEncode([ :ok = 0,
			:refuse = "card payment needs the server -- pay cash, or wait" ])
	ok
	aWOrderId + cId
	aWOrderState + "received"
	return JsonEncode([ :ok = 1, :payload = [ :id = cId, :pay = cPay ] ])

# ------------------------------------------------ feature 2: mark ready
# Monotonic on every rung; never a rollback (Law 6 inverted).
func WOrderMarkReady cId
	n = find(aWOrderId, cId)
	if n = 0
		return JsonEncode([ :ok = 0, :refuse = "no such order here" ])
	ok
	aWOrderState[n] = "ready"
	return JsonEncode([ :ok = 1, :payload = [ :id = cId, :to = "ready" ] ])

# ------------------------------------------- the snapshot contract (§3)
# Law 2: clear, then load. Ghosts -- locally-held ids the snapshot did not
# confirm -- are computed here and handed to the library by SnapReconcile.
#
# THE JUDGEMENT THE FIRST HARNESS RUN FORCED: an id absent from the
# snapshot is NOT automatically a ghost. A locally-placed order that has
# not reached the server yet is absent by definition -- it is an INTENT,
# still queued in the outbox, and reconciling it away would eat the
# device's own pending work. A ghost is an unconfirmed id with NOTHING en
# route for it. The outbox is readable from Ring in the same VM, so the
# distinction is one lookup -- and it is the world's business judgement,
# made where business rules live.
func WSnapApply cJson
	aDoc = JsonDecode(cJson)
	aNew = []
	for i = 1 to len(aDoc)
		if aDoc[i][1] = "orders"  aNew = aDoc[i][2]  ok
	next
	aWGhosts = []
	aKeep = []
	for i = 1 to len(aWOrderId)
		if find(aNew, aWOrderId[i]) = 0
			if WEnRoute(aWOrderId[i])
				aKeep + aWOrderId[i]        # an intent, not a ghost
			else
				aWGhosts + aWOrderId[i]
			ok
		ok
	next
	aWOrderId = aNew                    # REPLACED, never merged...
	for i = 1 to len(aKeep)
		aWOrderId + aKeep[i]        # ...plus the device's own pending intents
	next
	aWOrderState = []
	for i = 1 to len(aWOrderId)
		aWOrderState + "received"
	next
	return JsonEncode([ :ok = 1, :held = len(aWOrderId) ])

# Is anything in the outbox still CARRYING this entity toward the server?
# Kind matters: an "order" entry creates the entity on arrival, so it
# protects the id; a "transition" merely mutates something that must
# already exist there -- a queued transition on an unconfirmed id is
# exactly Law 3's trap, and protecting the ghost because of it would
# re-open the trap this reconcile exists to close.
func WEnRoute cId
	aEntries = JsonDecode(PwaOutboxList(1))
	for i = 1 to len(aEntries)
		cState = ""  cEntryId = ""  cKind = ""
		for j = 1 to len(aEntries[i])
			if aEntries[i][j][1] = "state"  cState = "" + aEntries[i][j][2]  ok
			if aEntries[i][j][1] = "id"     cEntryId = "" + aEntries[i][j][2]  ok
			if aEntries[i][j][1] = "kind"   cKind = "" + aEntries[i][j][2]  ok
		next
		if cKind != "order"
			loop
		ok
		if cState != "queued" and cState != "sent"
			loop
		ok
		aPay = JsonDecode(PwaOutboxPayload(cEntryId))
		for j = 1 to len(aPay)
			if aPay[j][1] = "payload"
				aInner = aPay[j][2]
				if islist(aInner)
					for k = 1 to len(aInner)
						if aInner[k][1] = "id" and ("" + aInner[k][2]) = cId
							return 1
						ok
					next
				ok
			ok
		next
	next
	return 0

func WSnapReconcile p
	return JsonEncode(aWGhosts)

# ------------------------------------------------------------- probes
func WSeed cId
	aWOrderId + cId
	aWOrderState + "received"
	return len(aWOrderId)

func WHas cId
	return find(aWOrderId, cId)

func WHeld p
	return JsonEncode(aWOrderId)
