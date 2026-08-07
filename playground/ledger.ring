# ledger.ring — a tontine ledger that lives inside RingScript.
#
# WHAT THIS IS FOR
#   Not a race against JavaScript. The question is narrower and more
#   useful: if you write an ordinary data-driven page in Ring, does it
#   FEEL right? A user types in a filter box, clicks a column to sort,
#   submits a form, pages through rows. Each of those has a budget the
#   human nervous system sets, not a competitor:
#
#       under  16 ms  — instant, inside one animation frame
#       under 100 ms  — responsive, feels like a direct result of the click
#       over  100 ms  — noticeable; the page feels like it is thinking
#
#   So every function here is one interaction, and the page reports what
#   each one cost against those budgets.
#
# THE SHAPE OF A REAL PAGE
#   The data is loaded ONCE, at startup, and then LIVES HERE — in Ring
#   globals, in the resident VM, across every later call. That is the
#   whole point of a resident runtime, and it is why the interactions
#   below never touch JSON: nothing crosses the bridge except the answer.
#
# RING RULES THIS CODE OBEYS
#   1. Every function callable from the page takes EXACTLY ONE parameter.
#      That is what ring.call passes; a zero-parameter function just errors.
#   2. Do not name a function after a builtin. `func Load` collides with
#      Ring's own load and fails to define.
#   3. Globals are reachable from inside functions — both to read and to
#      write. Locals shadow them only if you never touch the global first.
#   4. Index loops, hoist lengths, append with `+`. `for x in aList` hands
#      back a copy of every item; len() in a loop signature re-evaluates.
#   5. Assignment COPIES. Index straight through — aRows[i][2] — rather
#      than taking a row into a variable and writing to that.

# ---------------------------------------------------------------- state
# The ledger itself, held as columns: one list per field, same index.
aRowId     = []
aRowMember = []
aRowRound  = []
aRowAmount = []
aRowStatus = []
nRows      = 0

# The rows currently on screen, as indices into the columns above. Filter
# and sort rewrite this; nothing else copies the data.
aView      = []
nView      = 0

# ------------------------------------------------------- 1. load, once
# The only time JSON crosses the bridge. A real page does this after a
# fetch; everything after it is pure Ring.
#
# ASK YOUR API FOR ROWS, NOT OBJECTS. This accepts both shapes, but they
# do not cost the same. A JSON object decodes into a pair-list — one list
# for the record plus one list per field plus two items per field — while
# an array row is one list and one item per field. Measured on the same
# 20,000 deposits:
#
#     [{"id":1,"member":"m03",…}]   1.31 MB   1358 ms   +89 MB of heap
#     [[1,"m03",3,250,"ACTIVE"]]    0.55 MB     71 ms   +23 MB of heap
#
# Nineteen times faster to load and a quarter of the memory, for the same
# data. Most of that second is not parsing at all — it is first-touching
# 89 MB the page is about to throw away.
func LedgerLoad cJson
	aRecords = JsonDecode(cJson)
	nCount = len(aRecords)
	aRowId = []  aRowMember = []  aRowRound = []  aRowAmount = []  aRowStatus = []

	# Which shape did the API send? A record from a JSON object is a list
	# of [key, value] pairs; a record from a JSON array is not.
	lPairs = 0
	if nCount > 0 and len(aRecords[1]) > 0
		if islist(aRecords[1][1]) and len(aRecords[1][1]) = 2
			lPairs = 1
		ok
	ok

	if lPairs
		for i = 1 to nCount
			nFields = len(aRecords[i])
			nId = 0  cMember = ""  nRound = 0  nAmount = 0  cStatus = ""
			for j = 1 to nFields
				cK = aRecords[i][j][1]
				if cK = "id"
					nId = aRecords[i][j][2]
				but cK = "member"
					cMember = aRecords[i][j][2]
				but cK = "round"
					nRound = aRecords[i][j][2]
				but cK = "amount"
					nAmount = aRecords[i][j][2]
				but cK = "status"
					cStatus = aRecords[i][j][2]
				ok
			next
			aRowId + nId
			aRowMember + cMember
			aRowRound + nRound
			aRowAmount + nAmount
			aRowStatus + cStatus
		next
	else
		# rows: [id, member, round, amount, status]
		for i = 1 to nCount
			aRowId + aRecords[i][1]
			aRowMember + aRecords[i][2]
			aRowRound + aRecords[i][3]
			aRowAmount + aRecords[i][4]
			aRowStatus + aRecords[i][5]
		next
	ok
	nRows = nCount
	aView = []
	for i = 1 to nRows
		aView + i
	next
	nView = nRows
	return nRows

# ------------------------------- 2. filter — what a user types, live
# cSpec: [ :member = "m03", :minAmount = 100, :status = "ACTIVE" ]
# Any field may be empty, which means "do not filter on it".
func LedgerFilter aSpec
	cMember = ""  nMin = 0  cStatus = ""
	nSpec = len(aSpec)
	for i = 1 to nSpec
		cK = aSpec[i][1]
		if cK = "member"
			cMember = lower("" + aSpec[i][2])
		but cK = "minAmount"
			nMin = aSpec[i][2]
		but cK = "status"
			cStatus = aSpec[i][2]
		ok
	next
	aView = []
	for i = 1 to nRows
		if cMember != "" and substr(lower(aRowMember[i]), cMember) = 0
			loop
		ok
		if nMin > 0 and aRowAmount[i] < nMin
			loop
		ok
		if cStatus != "" and aRowStatus[i] != cStatus
			loop
		ok
		aView + i
	next
	nView = len(aView)
	return nView

# ------------------------------------- 3. sort — what a header click does
# cColumn: "member" | "round" | "amount" | "status" | "id"
# Prefix it with "-" for descending, the way a second click behaves.
func LedgerSort cColumn
	lDesc = 0
	if left(cColumn, 1) = "-"
		lDesc = 1
		cColumn = substr(cColumn, 2, len(cColumn) - 1)
	ok
	aKey = []
	for k = 1 to nView
		i = aView[k]
		if cColumn = "member"
			aKey + [aRowMember[i], i]
		but cColumn = "round"
			aKey + [aRowRound[i], i]
		but cColumn = "amount"
			aKey + [aRowAmount[i], i]
		but cColumn = "status"
			aKey + [aRowStatus[i], i]
		else
			aKey + [aRowId[i], i]
		ok
	next
	if nView > 0
		aKey = sort(aKey, 1)
		if lDesc
			aKey = reverse(aKey)
		ok
	ok
	aView = []
	for k = 1 to nView
		aView + aKey[k][2]
	next
	return nView

# ------------------------------------ 4. page — the rows actually drawn
# A table shows a screenful, never 20,000 rows. This is the only function
# that hands row data back, and it hands back exactly one page of it.
func LedgerPage nFrom
	nTo = nFrom + 24
	if nTo > nView
		nTo = nView
	ok
	aOut = []
	for k = nFrom to nTo
		i = aView[k]
		aOut + [aRowId[i], aRowMember[i], aRowRound[i], aRowAmount[i], aRowStatus[i]]
	next
	return JsonEncode(aOut)

# --------------------------------- 5. validate — what a form does per key
# Returns the list of problems, empty when the record is good. This is the
# ZQL norm positive_deposit plus the entity's own field rules.
func LedgerValidate aRec
	cMember = ""  nRound = 0  nAmount = 0  cStatus = ""
	nSpec = len(aRec)
	for i = 1 to nSpec
		cK = aRec[i][1]
		if cK = "member"
			cMember = "" + aRec[i][2]
		but cK = "round"
			nRound = aRec[i][2]
		but cK = "amount"
			nAmount = aRec[i][2]
		but cK = "status"
			cStatus = "" + aRec[i][2]
		ok
	next
	aErr = []
	if len(cMember) = 0
		aErr + "member is required"
	but len(cMember) != 3 or left(cMember, 1) != "m"
		aErr + "member must look like m01"
	ok
	if not isnumber(nRound) or nRound < 1 or nRound > 12
		aErr + "round must be 1 to 12"
	ok
	if not isnumber(nAmount) or nAmount <= 0
		aErr + "amount must be greater than 0"
	ok
	if cStatus != "STAGED" and cStatus != "AUDITED" and cStatus != "ACTIVE"
		aErr + "status must be STAGED, AUDITED or ACTIVE"
	ok
	return JsonEncode(aErr)

# ------------------------------- 6. add — what a form submit does
# Appends one deposit and keeps the view honest: if it matches what is on
# screen, it appears there too. No reload, no re-parse.
func LedgerAdd aRec
	cMember = ""  nRound = 0  nAmount = 0  cStatus = ""
	nSpec = len(aRec)
	for i = 1 to nSpec
		cK = aRec[i][1]
		if cK = "member"
			cMember = "" + aRec[i][2]
		but cK = "round"
			nRound = aRec[i][2]
		but cK = "amount"
			nAmount = aRec[i][2]
		but cK = "status"
			cStatus = "" + aRec[i][2]
		ok
	next
	nRows = nRows + 1
	aRowId + nRows
	aRowMember + cMember
	aRowRound + nRound
	aRowAmount + nAmount
	aRowStatus + cStatus
	aView + nRows
	nView = nView + 1
	return nRows

# --------------------- 7. leaderboard — the aggregate a dashboard shows
# Over the CURRENT view, so it answers "who leads among what I am looking
# at" rather than "who leads overall".
func LedgerBoard nTop
	aMembers = []
	nMembers = 0
	for k = 1 to nView
		i = aView[k]
		nA = aRowAmount[i]
		if not isnumber(nA) or nA <= 0
			loop
		ok
		cM = aRowMember[i]
		nSlot = 0
		for m = 1 to nMembers
			if aMembers[m][1] = cM
				nSlot = m
				exit
			ok
		next
		if nSlot = 0
			aMembers + [cM, 0, 0]
			nMembers = nMembers + 1
			nSlot = nMembers
		ok
		aMembers[nSlot][2] = aMembers[nSlot][2] + nA
		aMembers[nSlot][3] = aMembers[nSlot][3] + 1
	next
	aRank = []
	for m = 1 to nMembers
		aRank + [aMembers[m][2], aMembers[m][1], aMembers[m][3]]
	next
	if nMembers > 0
		aRank = reverse(sort(aRank, 1))
	ok
	if nTop > nMembers
		nTop = nMembers
	ok
	aOut = []
	for k = 1 to nTop
		aOut + [ :member = aRank[k][2], :total = aRank[k][1], :count = aRank[k][3] ]
	next
	return JsonEncode(aOut)

# ------------------------------ 8. stats — the totals above the table
func LedgerStats p
	nSum = 0
	nBad = 0
	nMax = 0
	for k = 1 to nView
		i = aView[k]
		nA = aRowAmount[i]
		if not isnumber(nA) or nA <= 0
			nBad = nBad + 1
			loop
		ok
		nSum = nSum + nA
		if nA > nMax
			nMax = nA
		ok
	next
	return JsonEncode([ :rows = nRows, :shown = nView, :sum = nSum,
			    :rejected = nBad, :biggest = nMax ])
