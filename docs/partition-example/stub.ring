# The proposed v2 surface, stubbed -- just enough that orders.ring compiles
# and runs on stock Ring, which is the gate PARTITION-FOUNDATIONS.md §2.4 must
# pass. In the real library the JS half maintains the rung (PwaRungSet on
# every transition) and the outbox lives in ring/pwa.ring; here both are
# pinned so the example's behaviour is deterministic and assertable.

# All state before the first func: Ring's main section is everything above
# the first function definition, and nothing below it runs on load.
cPwaRung = "unreachable"          # the scenario: mid-outage, alarm already fired
aStubQueue = []

func PwaRung
	return cPwaRung

func PwaRungSet cRung
	cPwaRung = cRung
	return cRung

# v1's PwaOutboxAdd, unchanged in shape (pwa.ring:40) -- the stub only
# records, so the test below can count what reached the queue.
func PwaOutboxAdd cJson
	aStubQueue + cJson
	return JsonEncode([ :ok = 1, :id = "order-stub-" + len(aStubQueue) ])

func PwaOutboxPending p
	return len(aStubQueue)

# ---- minimal JSON, enough for the example (the real runtime bakes json.ring
# ---- into the wasm; stock ring.exe here gets the same surface, stubbed)
func JsonEncode aPair
	return ListToJson(aPair)

func ListToJson aPair
	cOut = "{"
	for i = 1 to len(aPair)
		if i > 1 cOut = cOut + "," ok
		v = aPair[i][2]
		if isstring(v)
			cOut = cOut + '"' + aPair[i][1] + '":"' + v + '"'
		but isnumber(v)
			cOut = cOut + '"' + aPair[i][1] + '":' + v
		else
			cOut = cOut + '"' + aPair[i][1] + '":' + ListToJson(v)
		ok
	next
	return cOut + "}"

func JsonDecode cJson
	# the example's inputs are built by the test itself as pair-lists,
	# passed through verbatim -- decode is identity here
	return cJson
