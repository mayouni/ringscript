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

# ------------------------------------------- the index, made explicit
# The five column lists are read through aView, which filter and sort
# permute. A Ring list is a linked list with a cursor that serves only
# SEQUENTIAL access; against a permuted index every read walks from one
# end, and a single pass over n rows becomes O(n^2).
#
# ringvm_genarray() is Ring's own answer: it builds the items array once
# so indexed reads are O(1). It is deliberately opt-in, and this is why:
# ANY structural change to a list frees the array, and genarray rebuilds
# it whole. Rebuilding after every add costs O(n) per add — 824 us on a
# 20,000-row ledger, which is worse than the problem it solves.
#
# So the index is marked stale on a write and rebuilt at most once before
# the next read that needs it. Measured on 20,000 rows:
#
#     stats   14 ms indexed / 133 ms not      leaderboard 111 / 532
#     paging  21 ms indexed / 186 ms not      adds  4 us / 824 us
lIndexed = 0

# ---------------------------------------------------------------------------
#  THE TABLE ITSELF IS A LIBRARY NOW
# ---------------------------------------------------------------------------
#  Loading, filtering, sorting, paging, totals, the leaderboard - and the
#  index that keeps a sorted read from going quadratic - are ringscript-table.
#
#      ringscript add table
#
#  This file kept exactly two things, and they are the two a table library
#  cannot know: which payload shapes this API sends, and what makes a
#  deposit valid.
#
#  The function names below are unchanged, so the page that drives this did
#  not have to be touched - and the before/after timings compare exactly.
# ---------------------------------------------------------------------------

cLedgerCols = ["id", "member", "round", "amount", "status"]

# ------------------------------------------------------ 1. load, once
# The one place the wire is used. Accepts both shapes an API might send,
# because that IS this application's problem: a record from a JSON object
# arrives as a list of [key, value] pairs, one from a JSON array does not.
#
# Ask your API for rows, not objects. Measured on the same 20,000 deposits:
# objects 1.31 MB and 1358 ms, arrays 0.55 MB and 71 ms.
func LedgerLoad cJson
	aRecords = JsonDecode(cJson)
	nCount = len(aRecords)

	lPairs = 0
	if nCount > 0 and len(aRecords[1]) > 0
		if islist(aRecords[1][1]) and len(aRecords[1][1]) = 2
			lPairs = 1
		ok
	ok

	aRows = []
	if lPairs
		for i = 1 to nCount
			nId = 0  cMember = ""  nRound = 0  nAmount = 0  cStatus = ""
			for j = 1 to len(aRecords[i])
				cK = aRecords[i][j][1]
				if cK = "id"          nId = aRecords[i][j][2]      ok
				if cK = "member"      cMember = aRecords[i][j][2]  ok
				if cK = "round"       nRound = aRecords[i][j][2]   ok
				if cK = "amount"      nAmount = aRecords[i][j][2]  ok
				if cK = "status"      cStatus = aRecords[i][j][2]  ok
			next
			aRows + [nId, cMember, nRound, nAmount, cStatus]
		next
	else
		aRows = aRecords
	ok

	# The Ring door, not the JavaScript one. Handing this table over as
	# JSON would serialise and re-parse every row for nothing - 709 ms of
	# it at 50,000 rows.
	TableSetData(cLedgerCols, aRows)
	return TableCount(1)

# --------------------------------------- 2. filter, as a user types
# aSpec: [ :member = "m03", :minAmount = 100, :status = "ACTIVE" ]
# Any field may be empty, which means "do not filter on it".
func LedgerFilter aSpec
	cMember = ""  nMin = 0  cStatus = ""
	for i = 1 to len(aSpec)
		cK = aSpec[i][1]
		if cK = "member"      cMember = "" + aSpec[i][2]  ok
		if cK = "minAmount"   nMin = aSpec[i][2]          ok
		if cK = "status"      cStatus = aSpec[i][2]       ok
	next

	aTests = []
	if len(cMember) > 0
		aTests + [ :column = "member", :op = "contains", :value = cMember ]
	ok
	if isnumber(nMin) and nMin > 0
		aTests + [ :column = "amount", :op = "ge", :value = nMin ]
	ok
	if len("" + cStatus) > 0
		aTests + [ :column = "status", :op = "eq", :value = cStatus ]
	ok

	TableFilter(JsonEncode(aTests))
	return TableViewCount(1)

# ---------------------------------------- 3. sort, as a header is clicked
# "amount" ascending, "-amount" descending - the way a second click behaves.
func LedgerSort cColumn
	lDesc = 0
	if left(cColumn, 1) = "-"
		lDesc = 1
		cColumn = substr(cColumn, 2, len(cColumn) - 1)
	ok
	TableSort(JsonEncode([ :column = cColumn, :desc = lDesc ]))
	return TableViewCount(1)

# ------------------------------------------ 4. page, the rows drawn
func LedgerPage nFrom
	return TablePage(JsonEncode([ :from = nFrom, :count = 25 ]))

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
# ------------------------------- 6. add - what a form submit does
# Appends one deposit. The library keeps the view honest and marks its own
# index stale; this only has to say what a row looks like.
func LedgerAdd aRec
	cMember = ""  nRound = 0  nAmount = 0  cStatus = ""
	for i = 1 to len(aRec)
		cK = aRec[i][1]
		if cK = "member"   cMember = "" + aRec[i][2]  ok
		if cK = "round"    nRound = aRec[i][2]        ok
		if cK = "amount"   nAmount = aRec[i][2]       ok
		if cK = "status"   cStatus = "" + aRec[i][2]  ok
	next
	nId = TableCount(1) + 1
	TableAppend(JsonEncode([nId, cMember, nRound, nAmount, cStatus]))
	return TableCount(1)

# --------------------- 7. leaderboard - the aggregate a dashboard shows
# Over the CURRENT view, which is the library's default: it answers "who
# leads among what I am looking at", not "who leads overall".
func LedgerBoard nTop
	aG = JsonDecode(TableGroup(JsonEncode([ :by = "member",
	                                        :value = "amount", :top = nTop ])))
	aOut = []
	for i = 1 to len(aG)
		cName = ""  nTotal = 0  nCount = 0
		for j = 1 to len(aG[i])
			if aG[i][j][1] = "group"  cName = aG[i][j][2]   ok
			if aG[i][j][1] = "total"  nTotal = aG[i][j][2]  ok
			if aG[i][j][1] = "count"  nCount = aG[i][j][2]  ok
		next
		aOut + [ :member = cName, :total = nTotal, :count = nCount ]
	next
	return JsonEncode(aOut)

# ------------------------------ 8. stats - the totals above the table
# A deposit of zero or less is rejected rather than counted: a rule of this
# ledger, not a property of tables. The library totals a subset in ONE pass
# through `where`, so saying so costs nothing.
func LedgerStats p
	aA = JsonDecode(TableAggregate(JsonEncode([
		:column = "amount",
		:where = [ [ :column = "amount", :op = "gt", :value = 0 ] ] ])))
	nSum = 0  nMax = 0  nBad = 0
	for i = 1 to len(aA)
		if aA[i][1] = "sum"      nSum = aA[i][2]  ok
		if aA[i][1] = "max"      nMax = aA[i][2]  ok
		if aA[i][1] = "skipped"  nBad = aA[i][2]  ok
	next
	return JsonEncode([ :rows = TableCount(1), :shown = TableViewCount(1),
	                    :sum = nSum, :rejected = nBad, :biggest = nMax ])

