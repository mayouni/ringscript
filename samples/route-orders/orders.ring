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
# The queue itself lives in ringscript-pwa. What stays here is the one
# thing a queue cannot know: what a rejected order MEANS to a customer's
# credit.
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
#  4. FINISHING AN ORDER - and what a refusal costs
# =====================================================================
# Whether an order MAY be queued is a sales rule, so it stays here: not
# empty, and not over the customer's credit. What queueing MEANS - the id
# made on the device, the batch, the rollback - is the local-first pattern,
# and ringscript-pwa owns it.
#
# This file used to carry seven functions for that. Two applications had
# each written their own; that is what a library is for.
func OrderFinish p
	if nLines = 0
		return JsonEncode([ :ok = 0, :error = "the order is empty" ])
	ok
	cView = OrderView(1)
	aView = JsonDecode(cView)
	lBlocked = 0  nTotal = 0
	for i = 1 to len(aView)
		if aView[i][1] = "blocked"  lBlocked = aView[i][2]  ok
		if aView[i][1] = "total"    nTotal = aView[i][2]    ok
	next
	if lBlocked = 1
		return JsonEncode([ :ok = 0,
		                    :error = "over the credit limit - the device said so" ])
	ok

	cName = ""
	nRowC = CustomerRowOf(cOrderCustomer)
	if nRowC > 0
		cName = aCustName[nRowC]
		# the credit is committed the moment the order is taken, not when
		# the server hears about it - that is what makes the next order's
		# limit check honest with no signal
		aCustBalance[nRowC] = aCustBalance[nRowC] + nTotal
	ok

	aPayload = [ :customer = cOrderCustomer, :customer_name = cName,
	             :total = nTotal, :catalogue = cCatalogueDate,
	             :order = JsonDecode(cView) ]

	cOrderCustomer = ""
	aLineSku = []  aLineQty = []
	nLines = 0
	return JsonEncode([ :ok = 1, :total = nTotal, :payload = aPayload ])

# The server refused an order, so it did not happen: give the credit back.
# The library knows an entry was rejected; only this knows what that costs.
#
# cJson: [ [ :customer = "C-01", :total = 4200 ], ... ]
func CreditReturn cJson
	aRows = JsonDecode(cJson)
	nN = 0
	for i = 1 to len(aRows)
		cCust = ""  nTotal = 0
		for j = 1 to len(aRows[i])
			if aRows[i][j][1] = "customer"  cCust = "" + aRows[i][j][2]  ok
			if aRows[i][j][1] = "total"     nTotal = aRows[i][j][2]      ok
		next
		nRowC = CustomerRowOf(cCust)
		if nRowC > 0
			aCustBalance[nRowC] = aCustBalance[nRowC] - nTotal
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
	aBal = []
	for i = 1 to nCustomers
		aBal + [ aCustId[i], aCustBalance[i] ]
	next
	return JsonEncode([ :device = cDeviceId, :balances = aBal ])

func StateImport cJson
	if len("" + cJson) < 2  return JsonEncode([ :restored = 0 ])  ok
	aDoc = JsonDecode(cJson)
	aBal = []
	for i = 1 to len(aDoc)
		if aDoc[i][1] = "device"    cDeviceId = aDoc[i][2]  ok
		if aDoc[i][1] = "balances"  aBal = aDoc[i][2]       ok
	next
	# the provisional balances go back, or the credit rule would forget
	# every order taken before the tab was closed
	for i = 1 to len(aBal)
		nRowC = CustomerRowOf(aBal[i][1])
		if nRowC > 0  aCustBalance[nRowC] = aBal[i][2]  ok
	next
	return JsonEncode([ :restored = len(aBal) ])

func AppStats p
	return JsonEncode([ :customers = nCustomers, :products = nProducts,
	                    :currency = cCurrency, :catalogue_date = cCatalogueDate ])
