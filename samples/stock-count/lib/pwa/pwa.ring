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

# [ id, kind, payload, state, seq ]  — state is "queued" or "sent"
aPwaOutbox = []
cPwaDevice = "device"
nPwaSeq    = 0

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
	for i = 1 to len(aIn)
		if aIn[i][1] = "kind"
			cKind = "" + aIn[i][2]
		but aIn[i][1] = "payload"
			pPayload = aIn[i][2]
		ok
	next
	if len(cKind) = 0
		return JsonEncode([ :ok = 0, :problem = "an entry needs a kind" ])
	ok

	nPwaSeq = nPwaSeq + 1
	cId = cKind + "-" + cPwaDevice + "-" + nPwaSeq + "-" + clock()
	aPwaOutbox + [ cId, cKind, pPayload, "queued", nPwaSeq ]
	return JsonEncode([ :ok = 1, :id = cId, :kind = cKind ])

# ------------------------------------------------------------------ read
func PwaOutboxList p
	aOut = []
	for i = 1 to len(aPwaOutbox)
		aOut + [ :id = aPwaOutbox[i][1], :kind = aPwaOutbox[i][2],
			 :state = aPwaOutbox[i][4] ]
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
		ok
	next
	return len(aPwaOutbox)
