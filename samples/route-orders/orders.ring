# orders.ring — a field-sales order pad, written entirely in Ring.
#
# WHAT THIS IS
#   The business half of a real application: a sales representative walks a
#   route of shops, takes orders from a catalogue, and the orders reach the
#   back office later. Every rule that decides whether an order is valid —
#   the customer's price tier, the case discount, the tax, the credit limit —
#   lives HERE, in Ring, running on the device.
#
# WHY THAT MATTERS
#   A rule that lives on the server is a rule that stops working when the
#   connection does. A representative standing in a shop with no signal still
#   has to know whether this customer may take 40,000 more on credit. So the
#   server is used for exactly two things:
#
#       PULL   the reference data — customers, products, prices, tax rate
#       PUSH   the work — the orders taken since the last time
#
#   Everything between those two moments happens on the device, offline,
#   at full speed.
#
# THE SEAM
#   Ring owns the data and the rules. JavaScript owns the wires: fetch,
#   localStorage, the DOM. They speak JSON and nothing else, which is why
#   the back end can be written in any language you already use.
#
# RING RULES THIS CODE OBEYS
#   1. Every function callable from the page takes EXACTLY ONE parameter —
#      that is what ring.call passes. A zero-parameter function just errors.
#   2. Never name a function after a builtin (`func Load` collides with
#      Ring's own `load` and silently fails to define).
#   3. Index loops, hoist len() out of the loop header, append with `+`.
#      `for x in aList` hands back a COPY of every item.
#   4. Assignment copies: index straight through — aList[i][2] = ... —
#      rather than taking a row into a variable and writing to that.
#   5. An atom key is LOWERCASED on its way out: write `:stillQueued` and
#      the page reads `stillqueued`. Every key this file hands back is
#      therefore snake_case, which survives verbatim — what is written
#      here is exactly what JavaScript receives.

# ------------------------------------------------------------------ state
# The reference data, pulled from the server. Held as columns: one list per
# field, same index. Columns beat records here for the same reason they do
# in a spreadsheet — every scan touches one field, not the whole row.
aCustId = []  aCustName = []  aCustTown = []
aCustTier = []  aCustLimit = []  aCustBalance = []
nCustomers = 0

aProdSku = []  aProdName = []  aProdUnit = []  aProdCase = []
aProdStock = []  aProdPriceA = []  aProdPriceB = []  aProdPriceC = []
nProducts = 0

nTaxRate = 0            # e.g. 0.18 — comes from the server, never hard-coded
cCurrency = ""
cCatalogueDate = ""

# The order being written right now.
cOrderCustomer = ""
aLineSku = []  aLineQty = []
nLines = 0

# The outbox: orders taken but not yet acknowledged by the server. This is
# the whole reliability story — work is never lost because the network was
# not there when it was done.
#   aOutId       client-generated id, so a retry can never double-book
#   aOutCustomer aOutJson   the order as taken
#   aOutStatus   "pending" | "sent" | "accepted" | "rejected"
#   aOutNote     what the server said, when it said anything
aOutId = []  aOutCustomer = []  aOutJson = []
aOutStatus = []  aOutNote = []  aOutTotal = []
nOutbox = 0
nNextSeq = 1
cDeviceId = ""

# =====================================================================
#  1. PULL — the only reference data crossing the wire
# =====================================================================
# One JSON document, fetched once (and refreshed whenever the connection
# allows). Everything after this point works with the cable unplugged.
func RefLoad cJson
	aDoc = JsonDecode(cJson)
	nDoc = len(aDoc)
	for i = 1 to nDoc
		cKey = aDoc[i][1]
		if cKey = "taxRate"
			nTaxRate = aDoc[i][2]
		but cKey = "currency"
			cCurrency = aDoc[i][2]
		but cKey = "catalogueDate"
			cCatalogueDate = aDoc[i][2]
		but cKey = "deviceId"
			cDeviceId = aDoc[i][2]
		but cKey = "customers"
			RefTakeCustomers(aDoc[i][2])
		but cKey = "products"
			RefTakeProducts(aDoc[i][2])
		ok
	next
	return JsonEncode([ :customers = nCustomers, :products = nProducts,
	                    :tax_rate = nTaxRate, :currency = cCurrency,
	                    :catalogue_date = cCatalogueDate ])

func RefTakeCustomers aRows
	aCustId = []  aCustName = []  aCustTown = []
	aCustTier = []  aCustLimit = []  aCustBalance = []
	nRows = len(aRows)
	for i = 1 to nRows
		aCustId      + aRows[i][1]
		aCustName    + aRows[i][2]
		aCustTown    + aRows[i][3]
		aCustTier    + aRows[i][4]
		aCustLimit   + aRows[i][5]
		aCustBalance + aRows[i][6]
	next
	nCustomers = nRows
	return nRows

func RefTakeProducts aRows
	aProdSku = []  aProdName = []  aProdUnit = []  aProdCase = []
	aProdStock = []  aProdPriceA = []  aProdPriceB = []  aProdPriceC = []
	nRows = len(aRows)
	for i = 1 to nRows
		aProdSku    + aRows[i][1]
		aProdName   + aRows[i][2]
		aProdUnit   + aRows[i][3]
		aProdCase   + aRows[i][4]
		aProdStock  + aRows[i][5]
		aProdPriceA + aRows[i][6]
		aProdPriceB + aRows[i][7]
		aProdPriceC + aRows[i][8]
	next
	nProducts = nRows
	return nRows

# =====================================================================
#  2. LOOK THINGS UP — instant, because it is all already here
# =====================================================================
func CustomerFind cQuery
	cQ = lower("" + cQuery)
	aOut = []
	for i = 1 to nCustomers
		if cQ != "" and substr(lower(aCustName[i]), cQ) = 0 and
		   substr(lower(aCustTown[i]), cQ) = 0
			loop
		ok
		aOut + [ aCustId[i], aCustName[i], aCustTown[i], aCustTier[i],
		         aCustLimit[i], aCustBalance[i], aCustLimit[i] - aCustBalance[i] ]
		if len(aOut) >= 40  exit  ok
	next
	return JsonEncode(aOut)

func ProductFind cQuery
	cQ = lower("" + cQuery)
	nTierCol = TierColumnOf(cOrderCustomer)
	aOut = []
	for i = 1 to nProducts
		if cQ != "" and substr(lower(aProdName[i]), cQ) = 0 and
		   substr(lower(aProdSku[i]), cQ) = 0
			loop
		ok
		aOut + [ aProdSku[i], aProdName[i], aProdUnit[i], aProdCase[i],
		         aProdStock[i], PriceFor(i, nTierCol) ]
		if len(aOut) >= 40  exit  ok
	next
	return JsonEncode(aOut)

func CustomerRowOf cId
	for i = 1 to nCustomers
		if aCustId[i] = cId  return i  ok
	next
	return 0

func ProductRowOf cSku
	for i = 1 to nProducts
		if aProdSku[i] = cSku  return i  ok
	next
	return 0

# The price tier is a property of the CUSTOMER, and it is the first rule
# that would have needed a round trip if the catalogue lived on a server.
func TierColumnOf cCustomerId
	nRow = CustomerRowOf(cCustomerId)
	if nRow = 0  return 1  ok
	cTier = upper("" + aCustTier[nRow])
	if cTier = "B"  return 2  ok
	if cTier = "C"  return 3  ok
	return 1

func PriceFor nProdRow, nTierCol
	if nTierCol = 2  return aProdPriceB[nProdRow]  ok
	if nTierCol = 3  return aProdPriceC[nProdRow]  ok
	return aProdPriceA[nProdRow]

# =====================================================================
#  3. THE ORDER — written on the device, priced on the device
# =====================================================================
func OrderStart cCustomerId
	if CustomerRowOf(cCustomerId) = 0
		return JsonEncode([ :ok = 0, :error = "unknown customer" ])
	ok
	cOrderCustomer = cCustomerId
	aLineSku = []  aLineQty = []
	nLines = 0
	return JsonEncode([ :ok = 1, :customer = cCustomerId ])

func OrderAddLine aSpec
	cSku = ""  nQty = 0
	nSpec = len(aSpec)
	for i = 1 to nSpec
		cK = aSpec[i][1]
		if cK = "sku"
			cSku = "" + aSpec[i][2]
		but cK = "qty"
			nQty = aSpec[i][2]
		ok
	next
	if ProductRowOf(cSku) = 0
		return JsonEncode([ :ok = 0, :error = "unknown product " + cSku ])
	ok
	if not isnumber(nQty) or nQty <= 0
		return JsonEncode([ :ok = 0, :error = "quantity must be greater than zero" ])
	ok
	# same product twice is one line, not two — the shop meant to add more
	for i = 1 to nLines
		if aLineSku[i] = cSku
			aLineQty[i] = aLineQty[i] + nQty
			return JsonEncode([ :ok = 1, :merged = 1 ])
		ok
	next
	aLineSku + cSku
	aLineQty + nQty
	nLines = nLines + 1
	return JsonEncode([ :ok = 1, :merged = 0 ])

func OrderRemoveLine nIndex
	if nIndex < 1 or nIndex > nLines
		return JsonEncode([ :ok = 0 ])
	ok
	del(aLineSku, nIndex)
	del(aLineQty, nIndex)
	nLines = nLines - 1
	return JsonEncode([ :ok = 1 ])

# The whole of the pricing and the whole of the checking, in one pass.
# This function is the reason the application works offline: everything a
# representative needs to know before promising anything is decided here.
func OrderView p
	nTierCol = TierColumnOf(cOrderCustomer)
	aRows = []
	nSub = 0
	aWarn = []
	for i = 1 to nLines
		nRow = ProductRowOf(aLineSku[i])
		nUnit = PriceFor(nRow, nTierCol)
		nQty = aLineQty[i]
		# RULE: a full case earns 5% — the commonest trade term there is
		nDisc = 0
		if aProdCase[nRow] > 0 and nQty >= aProdCase[nRow]
			nDisc = 5
		ok
		nGross = nUnit * nQty
		nNet = nGross - (nGross * nDisc / 100)
		nSub = nSub + nNet
		# RULE: never promise stock that is not there — but do not block it
		# either, because a backorder is a real thing a shop may still want
		cFlag = ""
		if nQty > aProdStock[nRow]
			cFlag = "only " + aProdStock[nRow] + " in stock"
			aWarn + (aProdName[nRow] + ": " + cFlag)
		ok
		aRows + [ aProdSku[nRow], aProdName[nRow], nQty, aProdUnit[nRow],
		          nUnit, nDisc, nNet, cFlag ]
	next
	nTax = nSub * nTaxRate
	nTotal = nSub + nTax

	# RULE: the credit limit. This is the one that has to work with the
	# cable out — a representative cannot phone the office from a market.
	nRowC = CustomerRowOf(cOrderCustomer)
	nLimit = 0  nBalance = 0  cName = ""  cTier = ""
	if nRowC > 0
		nLimit = aCustLimit[nRowC]
		nBalance = aCustBalance[nRowC]
		cName = aCustName[nRowC]
		cTier = aCustTier[nRowC]
	ok
	nHeadroom = nLimit - nBalance
	lBlocked = 0
	if nTotal > nHeadroom
		lBlocked = 1
	ok

	return JsonEncode([
		:customer = cOrderCustomer, :customer_name = cName, :tier = cTier,
		:lines = aRows, :subtotal = nSub, :tax_rate = nTaxRate,
		:tax = nTax, :total = nTotal, :currency = cCurrency,
		:credit_limit = nLimit, :balance = nBalance, :headroom = nHeadroom,
		:blocked = lBlocked, :warnings = aWarn ])

# =====================================================================
#  4. THE OUTBOX — why nothing is ever lost
# =====================================================================
# An order is finished on the device and put in a queue. The queue is the
# unit of reliability: it survives a closed tab, a flat battery and a week
# without signal, and every entry carries an id the DEVICE generated, so
# sending it twice can never create two orders.
func OutboxAdd p
	if nLines = 0
		return JsonEncode([ :ok = 0, :error = "the order is empty" ])
	ok
	cView = OrderView(1)
	aView = JsonDecode(cView)
	lBlocked = 0  nTotal = 0
	nV = len(aView)
	for i = 1 to nV
		if aView[i][1] = "blocked"  lBlocked = aView[i][2]  ok
		if aView[i][1] = "total"    nTotal = aView[i][2]    ok
	next
	if lBlocked = 1
		return JsonEncode([ :ok = 0,
			:error = "over the credit limit — the office must approve this one" ])
	ok

	cId = cDeviceId + "-" + nNextSeq
	nNextSeq = nNextSeq + 1
	aOutId       + cId
	aOutCustomer + cOrderCustomer
	aOutJson     + cView
	aOutStatus   + "pending"
	aOutNote     + ""
	aOutTotal    + nTotal
	nOutbox = nOutbox + 1

	# provisionally raise the customer's balance: the representative must
	# see the effect of the order they just took on the next one they take,
	# long before any server has heard about it
	nRowC = CustomerRowOf(cOrderCustomer)
	if nRowC > 0
		aCustBalance[nRowC] = aCustBalance[nRowC] + nTotal
	ok

	cOrderCustomer = ""
	aLineSku = []  aLineQty = []
	nLines = 0
	return JsonEncode([ :ok = 1, :id = cId, :total = nTotal, :queued = OutboxPending(1) ])

func OutboxPending p
	nN = 0
	for i = 1 to nOutbox
		if aOutStatus[i] = "pending" or aOutStatus[i] = "sent"
			nN = nN + 1
		ok
	next
	return nN

func OutboxList p
	aOut = []
	for i = nOutbox to 1 step -1
		cName = ""
		nRowC = CustomerRowOf(aOutCustomer[i])
		if nRowC > 0  cName = aCustName[nRowC]  ok
		aOut + [ aOutId[i], cName, aOutTotal[i], aOutStatus[i], aOutNote[i] ]
	next
	return JsonEncode(aOut)

# =====================================================================
#  5. PUSH — the second and last time the wire is used
# =====================================================================
# Plain JSON, sent to whatever the back end happens to be written in. The
# device decides WHAT to send; the page only carries it.
func SyncPayload p
	aBatch = []
	for i = 1 to nOutbox
		if aOutStatus[i] != "pending"  loop  ok
		aBatch + [ :id = aOutId[i], :customer = aOutCustomer[i],
		           :total = aOutTotal[i], :order = aOutJson[i] ]
	next
	return JsonEncode([ :device = cDeviceId, :catalogue = cCatalogueDate,
	                    :count = len(aBatch), :orders = aBatch ])

func SyncMarkSent p
	nN = 0
	for i = 1 to nOutbox
		if aOutStatus[i] = "pending"
			aOutStatus[i] = "sent"
			nN = nN + 1
		ok
	next
	return nN

# The server answers per order, never for the batch as a whole — one
# rejected order must not lose the other nine.
func SyncApplyResult cJson
	aDoc = JsonDecode(cJson)
	aResults = []
	nD = len(aDoc)
	for i = 1 to nD
		if aDoc[i][1] = "results"  aResults = aDoc[i][2]  ok
	next
	nAcc = 0  nRej = 0
	nR = len(aResults)
	for i = 1 to nR
		cId = ""  cStatus = ""  cNote = ""
		nF = len(aResults[i])
		for j = 1 to nF
			cK = aResults[i][j][1]
			if cK = "id"      cId = "" + aResults[i][j][2]      ok
			if cK = "status"  cStatus = "" + aResults[i][j][2]  ok
			if cK = "note"    cNote = "" + aResults[i][j][2]    ok
		next
		for k = 1 to nOutbox
			if aOutId[k] = cId
				aOutStatus[k] = cStatus
				aOutNote[k] = cNote
				if cStatus = "accepted"  nAcc = nAcc + 1  ok
				if cStatus = "rejected"
					nRej = nRej + 1
					# give the credit back: the order did not happen
					nRowC = CustomerRowOf(aOutCustomer[k])
					if nRowC > 0
						aCustBalance[nRowC] = aCustBalance[nRowC] - aOutTotal[k]
					ok
				ok
			ok
		next
	next
	return JsonEncode([ :accepted = nAcc, :rejected = nRej,
	                    :still_queued = OutboxPending(1) ])

# A send that never arrived is not a send. Everything still marked "sent"
# when the connection failed goes back to "pending" and will be tried again.
func SyncRollback p
	nN = 0
	for i = 1 to nOutbox
		if aOutStatus[i] = "sent"
			aOutStatus[i] = "pending"
			nN = nN + 1
		ok
	next
	return nN

# =====================================================================
#  6. PERSISTENCE — Ring hands out a string, the page keeps it somewhere
# =====================================================================
# Ring does not know what localStorage is, and does not need to. It knows
# how to say everything it holds in one JSON string and how to take it back.
func StateExport p
	aQueue = []
	for i = 1 to nOutbox
		aQueue + [ aOutId[i], aOutCustomer[i], aOutJson[i],
		           aOutStatus[i], aOutNote[i], aOutTotal[i] ]
	next
	aBal = []
	for i = 1 to nCustomers
		aBal + [ aCustId[i], aCustBalance[i] ]
	next
	return JsonEncode([ :seq = nNextSeq, :device = cDeviceId,
	                    :queue = aQueue, :balances = aBal ])

func StateImport cJson
	if len("" + cJson) < 2  return JsonEncode([ :restored = 0 ])  ok
	aDoc = JsonDecode(cJson)
	aQueue = []  aBal = []
	nD = len(aDoc)
	for i = 1 to nD
		cK = aDoc[i][1]
		if cK = "seq"       nNextSeq = aDoc[i][2]   ok
		if cK = "device"    cDeviceId = aDoc[i][2]  ok
		if cK = "queue"     aQueue = aDoc[i][2]     ok
		if cK = "balances"  aBal = aDoc[i][2]       ok
	next
	aOutId = []  aOutCustomer = []  aOutJson = []
	aOutStatus = []  aOutNote = []  aOutTotal = []
	nQ = len(aQueue)
	for i = 1 to nQ
		aOutId       + aQueue[i][1]
		aOutCustomer + aQueue[i][2]
		aOutJson     + aQueue[i][3]
		aOutStatus   + aQueue[i][4]
		aOutNote     + aQueue[i][5]
		aOutTotal    + aQueue[i][6]
	next
	nOutbox = nQ
	# the provisional balances go back too, or the credit rule would forget
	# every order taken before the tab was closed
	nB = len(aBal)
	for i = 1 to nB
		nRowC = CustomerRowOf(aBal[i][1])
		if nRowC > 0  aCustBalance[nRowC] = aBal[i][2]  ok
	next
	return JsonEncode([ :restored = nQ, :pending = OutboxPending(1) ])

func AppStats p
	nAcc = 0  nRej = 0  nPend = 0  nValue = 0
	for i = 1 to nOutbox
		if aOutStatus[i] = "accepted"  nAcc = nAcc + 1   ok
		if aOutStatus[i] = "rejected"  nRej = nRej + 1   ok
		if aOutStatus[i] = "pending" or aOutStatus[i] = "sent"
			nPend = nPend + 1
			nValue = nValue + aOutTotal[i]
		ok
	next
	return JsonEncode([ :customers = nCustomers, :products = nProducts,
	                    :orders = nOutbox, :accepted = nAcc, :rejected = nRej,
	                    :pending = nPend, :pending_value = nValue,
	                    :currency = cCurrency, :catalogue_date = cCatalogueDate ])
