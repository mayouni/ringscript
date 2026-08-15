# Stock Count — the business logic, and nothing else.
#
# No HTML, no DOM, no localStorage, no fetch. This file decides things:
# what a count line is worth, whether a variance needs investigating,
# whether the session is finishable, and what goes in the outbox. The
# page decides how any of that looks.
#
# Everything here runs on the device, which is the point: a stock count
# happens in a back room with no signal, and "is this variance serious?"
# must be answerable there and then.
#
# Notes for anyone reading this as Ring:
#   1. Atom keys come back to JavaScript LOWERCASED (:stillQueued arrives
#      as stillqueued), so the keys here are snake_case and survive intact.
#   2. ring.call() passes exactly ONE argument, so anything with several
#      fields arrives as JSON and is decoded here.
#   3. Assignment copies. Index straight through aRows[i][2] rather than
#      lifting a row into a variable inside a hot loop.

# ------------------------------------------------------- the reference data
# Pulled from the server once, at the start of a shift, and then owned by
# the device. Columns, not rows of records — see the note in the README.
aSkuCode  = []
aSkuName  = []
aSkuExpect = []
aSkuCost  = []
nSkus     = 0

# What has actually been counted this session. 0 = not yet counted.
aCounted  = []
aHasCount = []

# A shortage worth more than this is not a miscount, it is a question for
# somebody. The threshold is a business rule, so it lives here.
nInvestigateOver = 5000

# ------------------------------------------------------------- 1. the shift
func StockLoad cJson
	aRecords = JsonDecode(cJson)
	nCount = len(aRecords)
	aSkuCode = []  aSkuName = []  aSkuExpect = []  aSkuCost = []
	aCounted = []  aHasCount = []
	for i = 1 to nCount
		aSkuCode   + aRecords[i][1]
		aSkuName   + aRecords[i][2]
		aSkuExpect + aRecords[i][3]
		aSkuCost   + aRecords[i][4]
		aCounted   + 0
		aHasCount  + 0
	next
	nSkus = nCount
	return nSkus

# ---------------------------------------------------- 2. one counted line
# The whole reason this is not a form validation library: the verdict
# depends on money, not on the number typed.
func StockCount cJson
	aIn = JsonDecode(cJson)
	cSku = "" + aIn[1][2]
	nQty = aIn[2][2]

	nRow = 0
	for i = 1 to nSkus
		if aSkuCode[i] = cSku
			nRow = i
			exit
		ok
	next
	if nRow = 0
		return JsonEncode([ :ok = 0, :problem = "no such item" ])
	ok
	if not isnumber(nQty) or nQty < 0 or floor(nQty) != nQty
		return JsonEncode([ :ok = 0, :problem = "a count is a whole number, zero or more" ])
	ok

	aCounted[nRow] = nQty
	aHasCount[nRow] = 1

	nVar = nQty - aSkuExpect[nRow]
	nValue = nVar * aSkuCost[nRow]
	cVerdict = "match"
	if nVar < 0
		cVerdict = "short"
		if (0 - nValue) > nInvestigateOver
			cVerdict = "investigate"
		ok
	but nVar > 0
		cVerdict = "over"
	ok

	return JsonEncode([ :ok = 1, :sku = cSku, :name = aSkuName[nRow],
			    :expected = aSkuExpect[nRow], :counted = nQty,
			    :variance = nVar, :variance_value = nValue,
			    :verdict = cVerdict ])

# --------------------------------------------------------- 3. the progress
# What the header shows. Recomputed rather than tracked, because a count
# can be corrected and a running total would drift.
func StockProgress p
	nDone = 0  nShort = 0  nOver = 0  nFlag = 0  nNet = 0
	for i = 1 to nSkus
		if aHasCount[i] = 0
			loop
		ok
		nDone = nDone + 1
		nVar = aCounted[i] - aSkuExpect[i]
		nValue = nVar * aSkuCost[i]
		nNet = nNet + nValue
		if nVar < 0
			nShort = nShort + 1
			if (0 - nValue) > nInvestigateOver
				nFlag = nFlag + 1
			ok
		but nVar > 0
			nOver = nOver + 1
		ok
	next
	return JsonEncode([ :items = nSkus, :counted = nDone,
			    :remaining = nSkus - nDone, :short = nShort,
			    :over = nOver, :flagged = nFlag, :net_value = nNet,
			    :finishable = (nDone = nSkus) ])

# ------------------------------------------------------ 4. the worst lines
# A supervisor does not read 60 rows; they read the five that matter.
func StockDiscrepancies nTop
	aRank = []
	for i = 1 to nSkus
		if aHasCount[i] = 0
			loop
		ok
		nVar = aCounted[i] - aSkuExpect[i]
		if nVar = 0
			loop
		ok
		nValue = nVar * aSkuCost[i]
		nAbs = nValue
		if nAbs < 0
			nAbs = 0 - nAbs
		ok
		aRank + [nAbs, aSkuCode[i], aSkuName[i], nVar, nValue]
	next
	if len(aRank) > 0
		aRank = reverse(sort(aRank, 1))
	ok
	if nTop > len(aRank)
		nTop = len(aRank)
	ok
	aOut = []
	for k = 1 to nTop
		aOut + [ :sku = aRank[k][2], :name = aRank[k][3],
			 :variance = aRank[k][4], :variance_value = aRank[k][5] ]
	next
	return JsonEncode(aOut)

# ------------------------------------------------------------ 5. the sheet
# Every line, for the table. One page of a stock count is short enough to
# hand back whole.
func StockSheet p
	aOut = []
	for i = 1 to nSkus
		nVar = 0
		if aHasCount[i] = 1
			nVar = aCounted[i] - aSkuExpect[i]
		ok
		aOut + [ aSkuCode[i], aSkuName[i], aSkuExpect[i],
			 aCounted[i], aHasCount[i], nVar ]
	next
	return JsonEncode(aOut)

# ------------------------------------------------- 6. finishing a count
# Deciding whether a count MAY be submitted is a stock rule, so it stays
# here. Queueing it, naming it, retrying it and rolling it back are not -
# they are the local-first pattern, and ringscript-pwa owns them.
#
# This used to be six functions in this file. The samples that needed them
# had each written their own; that is what a library is for.
func StockFinish cCountedBy
	nDone = 0
	for i = 1 to nSkus
		if aHasCount[i] = 1
			nDone = nDone + 1
		ok
	next
	if nDone < nSkus
		return JsonEncode([ :ok = 0,
				    :problem = "" + (nSkus - nDone) + " items are not counted yet" ])
	ok

	aLines = []
	for i = 1 to nSkus
		aLines + [ aSkuCode[i], aCounted[i], aCounted[i] - aSkuExpect[i] ]
	next
	return JsonEncode([ :ok = 1, :counted_by = cCountedBy,
			    :items = nSkus, :lines = aLines ])

# ------------------------------------------------- 7. save and restore
# The page owns storage; Ring owns the shape of what is stored. Handing
# the whole session back as one value keeps that boundary honest.
func StockSnapshot p
	return JsonEncode([ :counted = aCounted, :has_count = aHasCount ])

func StockRestore cJson
	aIn = JsonDecode(cJson)
	for i = 1 to len(aIn)
		if aIn[i][1] = "counted"
			aCounted = aIn[i][2]
		but aIn[i][1] = "has_count"
			aHasCount = aIn[i][2]
		ok
	next
	return nSkus
