# RingScript PWA — the Ring half.
#
# The outbox, and nothing else. No DOM, no fetch, no localStorage: this
# file decides what a queued unit of work is, when it may be considered
# sent, and what happens when a send fails. The browser half moves the
# bytes.
#
# It exists because two samples wrote it twice. A field-sales order pad and
# a stock-count pad both needed: a device-generated id so a retry cannot
# create a duplicate, one verdict per entry, and a rollback that puts a
# failed send back rather than losing it. That is not app logic, it is the
# local-first pattern, and it belongs here.
#
# Every function returns JSON so the page can use the answer directly, and
# every output key is snake_case because atom keys reach JavaScript
# lower-cased.

# [ id, kind, payload, state, seq, note, created ]
# state: queued | sent | accepted | rejected
# created: milliseconds, supplied by the browser half at add time (0 for
# entries written before 2.0) -- Ring has no wall clock worth trusting here,
# and the page's clock is injectable for tests, so time always arrives.
aPwaOutbox = []
cPwaDevice = "device"
nPwaSeq    = 0

# The degraded-mode rung, PARTITION-FOUNDATIONS.md section 4. Maintained by
# the browser half (PwaRungSet on every transition) and READ BY WORLD RULES:
# a refusal like "card payment needs the server" is a business rule, and
# business rules live in this half, not in UI glue. "alone" is the honest
# boot state -- the server has not spoken yet.
#   alone -> streaming (first snapshot / first successful exchange)
#   streaming -> unreachable (the silence alarm)
#   unreachable -> streaming (the reconnection sequence completes)
cPwaRung = "alone"

# ------------------------------------------------------------------ rung
func PwaRung p
	return cPwaRung

func PwaRungSet cRung
	if isstring(cRung) and (cRung = "streaming" or cRung = "unreachable" or cRung = "alone")
		cPwaRung = cRung
	ok
	return cPwaRung

# --------------------------------------------------------------- identity
# Called once, with something stable for this device or user. The id is
# built from it, so two devices working offline cannot collide and the
# server can recognise a retry of work it has already accepted.
func PwaOutboxDevice cTag
	if isstring(cTag) and len(cTag) > 0
		cPwaDevice = cTag
	ok
	return cPwaDevice

# ------------------------------------------------------------------- add
# cJson: [ :kind = "order", :payload = <anything> ]
#
# The id is made HERE, on the device, before anything is sent. That is the
# whole trick: the work is named while it is still local, so a dropped
# connection during a send is a retry rather than a second order.
func PwaOutboxAdd cJson
	aIn = JsonDecode(cJson)
	cKind = ""
	pPayload = ""
	nNow = 0
	for i = 1 to len(aIn)
		if aIn[i][1] = "kind"
			cKind = "" + aIn[i][2]
		but aIn[i][1] = "payload"
			pPayload = aIn[i][2]
		but aIn[i][1] = "now"
			if isnumber(aIn[i][2])  nNow = aIn[i][2]  ok
		ok
	next
	if len(cKind) = 0
		return JsonEncode([ :ok = 0, :problem = "an entry needs a kind" ])
	ok

	nPwaSeq = nPwaSeq + 1
	cId = cKind + "-" + cPwaDevice + "-" + nPwaSeq + "-" + clock()
	aPwaOutbox + [ cId, cKind, pPayload, "queued", nPwaSeq, "", nNow ]
	return JsonEncode([ :ok = 1, :id = cId, :kind = cKind ])

# The entry never happened. Exists for exactly one caller: the browser half
# rolls an add back when the persist that must accompany it fails, because
# an entry held only in memory is a durability lie with a countdown
# (PARTITION-FOUNDATIONS.md section 2.3, the storage-full contract).
func PwaOutboxDrop cId
	for i = 1 to len(aPwaOutbox)
		if aPwaOutbox[i][1] = cId
			del(aPwaOutbox, i)
			return JsonEncode([ :ok = 1, :id = cId ])
		ok
	next
	return JsonEncode([ :ok = 0, :problem = "no such entry" ])

# ------------------------------------------------------------------ read
func PwaOutboxList p
	aOut = []
	for i = 1 to len(aPwaOutbox)
		aOut + [ :id = aPwaOutbox[i][1], :kind = aPwaOutbox[i][2],
			 :state = aPwaOutbox[i][4], :note = aPwaOutbox[i][6] ]
	next
	return JsonEncode(aOut)

# One entry at a time, deliberately. A half-successful sync then leaves the
# rest queued instead of losing them with the batch.
func PwaOutboxPayload cId
	for i = 1 to len(aPwaOutbox)
		if aPwaOutbox[i][1] = cId
			return JsonEncode([ :ok = 1, :id = cId, :kind = aPwaOutbox[i][2],
					    :payload = aPwaOutbox[i][3] ])
		ok
	next
	return JsonEncode([ :ok = 0, :problem = "no such entry" ])

func PwaOutboxPending p
	n = 0
	for i = 1 to len(aPwaOutbox)
		if aPwaOutbox[i][4] = "queued"
			n = n + 1
		ok
	next
	return n

# Seconds the oldest queued entry has waited, given the page's idea of now
# (milliseconds). -1 when nothing is queued. An entry from before 2.0 has no
# created stamp and reports as 0 -- "unknown" must never inflate the figure
# a banner shows.
func PwaOutboxOldest nNow
	nOldest = -1
	for i = 1 to len(aPwaOutbox)
		if aPwaOutbox[i][4] = "queued"
			nAge = 0
			if aPwaOutbox[i][7] > 0 and isnumber(nNow)
				nAge = floor((nNow - aPwaOutbox[i][7]) / 1000)
				if nAge < 0  nAge = 0  ok
			ok
			if nAge > nOldest  nOldest = nAge  ok
		ok
	next
	return nOldest

# ---------------------------------------------------------------- verdict
func PwaOutboxSent cId
	return PwaOutboxSetState(cId, "sent")

# The half people forget. A send that failed is not a send; put it back so
# the next connection tries again. Without this a queue is a place work
# goes to disappear.
func PwaOutboxRollback cId
	return PwaOutboxSetState(cId, "queued")

func PwaOutboxSetState cId, cState
	for i = 1 to len(aPwaOutbox)
		if aPwaOutbox[i][1] = cId
			aPwaOutbox[i][4] = cState
			return JsonEncode([ :ok = 1, :id = cId, :state = cState ])
		ok
	next
	return JsonEncode([ :ok = 0, :problem = "no such entry" ])

# ------------------------------------------------- the batch, and verdicts
# One entry at a time is right when each is its own request. It is wrong on
# a bad link, where ten requests are ten chances to fail: sending one batch
# and letting the server answer per entry is fewer round trips AND keeps the
# guarantee, because one refused entry must not lose the other nine.
#
# Added in 1.1 because a second application needed it. The first sent one
# count a shift; the second sends a route's worth of orders at once.
func PwaOutboxBatch p
	aBatch = []
	for i = 1 to len(aPwaOutbox)
		if aPwaOutbox[i][4] != "queued"
			loop
		ok
		aBatch + [ :id = aPwaOutbox[i][1], :kind = aPwaOutbox[i][2],
			   :payload = aPwaOutbox[i][3] ]
	next
	return JsonEncode([ :device = cPwaDevice, :count = len(aBatch),
			    :entries = aBatch ])

# Everything in the batch is now in flight. If the send fails, roll it back.
func PwaOutboxMarkSending p
	nN = 0
	for i = 1 to len(aPwaOutbox)
		if aPwaOutbox[i][4] = "queued"
			aPwaOutbox[i][4] = "sent"
			nN = nN + 1
		ok
	next
	return nN

# cJson: [ :results = [ [ :id = "...", :status = "accepted", :note = "..." ] ] ]
#
# The server answers per entry, never for the batch as a whole. An unknown
# status is stored as given rather than guessed at - the application knows
# what its own server means.
func PwaOutboxApply cJson
	aDoc = JsonDecode(cJson)
	aResults = []
	for i = 1 to len(aDoc)
		if aDoc[i][1] = "results"
			aResults = aDoc[i][2]
		ok
	next
	nAcc = 0  nRej = 0
	for i = 1 to len(aResults)
		cId = ""  cStatus = ""  cNote = ""
		for j = 1 to len(aResults[i])
			cK = aResults[i][j][1]
			if cK = "id"          cId = "" + aResults[i][j][2]      ok
			if cK = "status"      cStatus = "" + aResults[i][j][2]  ok
			if cK = "note"        cNote = "" + aResults[i][j][2]    ok
		next
		for k = 1 to len(aPwaOutbox)
			if aPwaOutbox[k][1] = cId
				aPwaOutbox[k][4] = cStatus
				aPwaOutbox[k][6] = cNote
				if cStatus = "accepted"  nAcc = nAcc + 1  ok
				if cStatus = "rejected"  nRej = nRej + 1  ok
			ok
		next
	next
	return JsonEncode([ :accepted = nAcc, :rejected = nRej,
			    :still_queued = PwaOutboxPending(1) ])

# A send that never arrived is not a send: everything left "sent" goes back.
func PwaOutboxRollbackAll p
	nN = 0
	for i = 1 to len(aPwaOutbox)
		if aPwaOutbox[i][4] = "sent"
			aPwaOutbox[i][4] = "queued"
			nN = nN + 1
		ok
	next
	return nN

# Entries already accepted by the server. Kept until the app drops them, so
# a screen can show "sent" rather than having work vanish on success.
func PwaOutboxForget p
	aKeep = []
	for i = 1 to len(aPwaOutbox)
		if aPwaOutbox[i][4] != "sent"
			aKeep + aPwaOutbox[i]
		ok
	next
	n = len(aPwaOutbox) - len(aKeep)
	aPwaOutbox = aKeep
	return n

# ------------------------------------------------------ save and restore
# The page owns storage; this owns the shape of what is stored. Handing the
# queue over as one value keeps that boundary honest, and means a restart
# restores work that was never sent.
func PwaOutboxSnapshot p
	return JsonEncode([ :device = cPwaDevice, :seq = nPwaSeq,
			    :entries = aPwaOutbox ])

func PwaOutboxRestore cJson
	if not isstring(cJson) or len(cJson) = 0
		return 0
	ok
	aIn = JsonDecode(cJson)
	for i = 1 to len(aIn)
		if aIn[i][1] = "device"
			cPwaDevice = "" + aIn[i][2]
		but aIn[i][1] = "seq"
			nPwaSeq = aIn[i][2]
		but aIn[i][1] = "entries"
			aPwaOutbox = aIn[i][2]
			# entries written before 1.1 have no note column, and
			# entries written before 2.0 have no created stamp
			for k = 1 to len(aPwaOutbox)
				if len(aPwaOutbox[k]) < 6
					aPwaOutbox[k] + ""
				ok
				if len(aPwaOutbox[k]) < 7
					aPwaOutbox[k] + 0
				ok
			next
		ok
	next
	return len(aPwaOutbox)
