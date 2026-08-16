# RingScript Table — rows on the device.
#
# Filter, sort, page, aggregate and group a table that lives in the VM. No
# DOM, no fetch, no localStorage: this decides what the answer is, and the
# page decides how it looks.
#
# It exists because three applications wrote it. A savings-circle register,
# a field-sales order pad and a stock-count pad all held rows on the device
# and all needed the same five verbs — and one of them found, the hard way,
# that getting the index wrong turns a linear pass into a quadratic one.
#
# ---------------------------------------------------------------------------
# THREE DECISIONS, EACH LEARNED BY MEASUREMENT
#
# 1. COLUMNS, NOT ROWS OF RECORDS.
#    The same 20,000 deposits as JSON objects cost 1,358 ms and 89 MB to
#    load; as arrays, 71 ms and 23 MB. Nineteen times faster for the same
#    data. So a table here is one list per column, and a row is an index.
#
# 2. A VIEW IS A LIST OF INDICES.
#    Filter and sort rewrite the view. Nothing copies the data, so sorting
#    20,000 rows moves 20,000 numbers rather than 20,000 records.
#
# 3. THE INDEX IS EXPLICIT, AND REBUILT AT MOST ONCE.
#    A Ring list is a linked list with a cursor. The cursor makes sequential
#    reads O(1) and does nothing for random ones — and reading through a
#    sorted view IS random. Without an index, one pass over a sorted 20,000
#    rows took 1.16 s; with it, 96 ms.
#
#    ringvm_genarray() builds that index. It is opt-in for a reason: ANY
#    structural change to a list frees it, and genarray rebuilds it whole.
#    Rebuilding after every append costs O(n) per append. So the index is
#    marked stale on a write and rebuilt at most once before the next read
#    that needs it — never inside a loop, never per access.
# ---------------------------------------------------------------------------
#
# Every function takes and returns JSON, because ring.call() passes exactly
# one argument. Output keys are snake_case: atom keys reach JavaScript
# lower-cased, and snake_case survives that intact.

aTableCols  = []      # column names, in order
aTableData  = []      # aTableData[c] is the whole column
nTableRows  = 0

aTableView  = []      # indices into the rows, in display order
nTableView  = 0

lTableIndexed = 0     # is the items array current?

# Below this, a linear walk is cheaper than building an index.
nTableIndexFloor = 64

# =========================================================== 1. the index
# The single most important function here, and the one applications keep
# getting wrong. Call it before a pass that reads through a permuted view;
# it costs nothing when the index is already current.
func TableIndex p
	if lTableIndexed = 1 or nTableRows <= nTableIndexFloor
		lTableIndexed = 1
		return 0
	ok
	for c = 1 to len(aTableData)
		ringvm_genarray(aTableData[c])
	next
	ringvm_genarray(aTableView)
	lTableIndexed = 1
	return len(aTableData)

# Any write invalidates it. Cheap: a flag, not a rebuild.
func TableTouch p
	lTableIndexed = 0
	return 0

# Below how many rows indexing is not worth the allocation. Exposed so the
# benefit can be measured rather than believed: set it above your row count
# and every read falls back to walking the list.
func TableIndexFloor n
	if isnumber(n) and n >= 0
		nTableIndexFloor = n
		lTableIndexed = 0
	ok
	return nTableIndexFloor

# =========================================================== 2. loading
#
# TWO DOORS, AND USING THE WRONG ONE IS EXPENSIVE.
#
# TableLoad() takes JSON because that is how JavaScript calls into Ring:
# ring.call() passes one string, so a table crosses the bridge as text.
#
# TableSetData() takes the lists directly, and is what RING code should
# call. JSON is the JavaScript boundary, not an internal one — a Ring
# application handing its table to a Ring library as JSON pays a full
# serialise and parse of its own data for nothing:
#
#     20,000 rows   encode 28 ms  + decode  83 ms  =  111 ms wasted
#     50,000 rows   encode 36 ms  + decode 673 ms  =  709 ms wasted
#
# The decode is worse than linear, so the mistake grows with the table. A
# register that took 442 ms to load took 2,226 ms through the wrong door.
func TableSetData aCols, aRows
	if len(aCols) = 0
		return JsonEncode([ :ok = 0, :problem = "a table needs columns" ])
	ok
	aTableCols = aCols
	aTableData = []
	nC = len(aCols)
	for c = 1 to nC
		aTableData + []
	next

	nR = len(aRows)
	for r = 1 to nR
		for c = 1 to nC
			aTableData[c] + aRows[r][c]
		next
	next
	nTableRows = nR

	aTableView = []
	for r = 1 to nR
		aTableView + r
	next
	nTableView = nR
	lTableIndexed = 0
	return JsonEncode([ :ok = 1, :rows = nTableRows, :columns = nC ])

# The JavaScript door. Same work, plus the parse the bridge requires.
# cJson: [ :columns = ["id","member",...], :rows = [[...],[...]] ]
func TableLoad cJson
	aIn = JsonDecode(cJson)
	aCols = []
	aRows = []
	for i = 1 to len(aIn)
		if aIn[i][1] = "columns"
			aCols = aIn[i][2]
		but aIn[i][1] = "rows"
			aRows = aIn[i][2]
		ok
	next
	return TableSetData(aCols, aRows)

func TableColumns p
	return JsonEncode(aTableCols)

func TableCount p
	return nTableRows

func TableViewCount p
	return nTableView

# Which column is called this? 0 when there is no such column.
func TableColumnOf cName
	for c = 1 to len(aTableCols)
		if aTableCols[c] = cName
			return c
		ok
	next
	return 0

# =========================================================== 3. filtering
# cJson: [ [ :column = "status", :op = "eq", :value = "ACTIVE" ], ... ]
#
# Every test must pass. Ops: eq ne gt ge lt le contains starts.
# Rebuilds the view from ALL rows, so a filter is never applied twice by
# accident.
func TableFilter cJson
	aSpec = JsonDecode(cJson)
	TableIndex(1)

	aTests = []
	for i = 1 to len(aSpec)
		cCol = ""  cOp = "eq"  pVal = ""
		for j = 1 to len(aSpec[i])
			if aSpec[i][j][1] = "column"  cCol = "" + aSpec[i][j][2]  ok
			if aSpec[i][j][1] = "op"      cOp = "" + aSpec[i][j][2]   ok
			if aSpec[i][j][1] = "value"   pVal = aSpec[i][j][2]       ok
		next
		nC = TableColumnOf(cCol)
		if nC = 0
			return JsonEncode([ :ok = 0, :problem = "no column called " + cCol ])
		ok
		nCode = TableOpCode(cOp)
		if nCode = 0
			return JsonEncode([ :ok = 0, :problem = "no such op: " + cOp ])
		ok
		aTests + [nC, nCode, pVal]
	next

	nTests = len(aTests)
	aTableView = []
	for r = 1 to nTableRows
		lKeep = 1
		for t = 1 to nTests
			v = aTableData[aTests[t][1]][r]
			o = aTests[t][2]
			w = aTests[t][3]
			lOk = 0
			if o = 1        lOk = (v = w)
			but o = 2       lOk = (v != w)
			but o = 3       lOk = (v > w)
			but o = 4       lOk = (v >= w)
			but o = 5       lOk = (v <= w) and (v != w)
			but o = 6       lOk = (v <= w)
			but o = 7       lOk = (substr(lower("" + v), lower("" + w)) > 0)
			but o = 8       lOk = (left(lower("" + v), len("" + w)) = lower("" + w))
			ok
			if lOk = 0
				lKeep = 0
				exit
			ok
		next
		if lKeep = 1
			aTableView + r
		ok
	next
	nTableView = len(aTableView)
	return JsonEncode([ :ok = 1, :shown = nTableView, :of = nTableRows ])

# An op resolved to a number, once. Comparing strings per row costs as much
# as the comparison itself, and calling a function to do it costs about six
# times the inlined test: 20,000 iterations are 13.5 ms through a function
# and 2.3 ms inline. On a table that is the difference between a page that
# feels instant and one that does not.
func TableOpCode cOp
	if cOp = "eq"        return 1 ok
	if cOp = "ne"        return 2 ok
	if cOp = "gt"        return 3 ok
	if cOp = "ge"        return 4 ok
	if cOp = "lt"        return 5 ok
	if cOp = "le"        return 6 ok
	if cOp = "contains"  return 7 ok
	if cOp = "starts"    return 8 ok
	return 0

func TableTest pCell, cOp, pVal
	if cOp = "eq"       return (pCell = pVal) ok
	if cOp = "ne"       return (pCell != pVal) ok
	if cOp = "gt"       return (pCell > pVal) ok
	if cOp = "ge"       return (pCell >= pVal) ok
	if cOp = "lt"       return (pCell < pVal) ok
	if cOp = "le"       return (pCell <= pVal) ok
	if cOp = "contains" return (substr(lower("" + pCell), lower("" + pVal)) > 0) ok
	if cOp = "starts"   return (left(lower("" + pCell), len("" + pVal)) = lower("" + pVal)) ok
	return 0

# Every row, in original order.
func TableAll p
	aTableView = []
	for r = 1 to nTableRows
		aTableView + r
	next
	nTableView = nTableRows
	return nTableView

# =========================================================== 4. sorting
# cJson: [ :column = "amount", :desc = 1 ]
#
# Sorts [key, rowIndex] pairs and keeps the indices. sort(list, 1) is the
# column sort Ring fixed in 1.28; on 1.27 it is the one that was quadratic,
# which is why the index above matters here more than anywhere.
func TableSort cJson
	aIn = JsonDecode(cJson)
	cCol = ""  lDesc = 0
	for i = 1 to len(aIn)
		if aIn[i][1] = "column"  cCol = "" + aIn[i][2]  ok
		if aIn[i][1] = "desc"    lDesc = aIn[i][2]      ok
	next
	nC = TableColumnOf(cCol)
	if nC = 0
		return JsonEncode([ :ok = 0, :problem = "no column called " + cCol ])
	ok

	TableIndex(1)
	aKey = []
	for k = 1 to nTableView
		i = aTableView[k]
		aKey + [ aTableData[nC][i], i ]
	next
	if nTableView > 0
		aKey = sort(aKey, 1)
		if lDesc = 1
			aKey = reverse(aKey)
		ok
	ok
	aTableView = []
	for k = 1 to nTableView
		aTableView + aKey[k][2]
	next
	return JsonEncode([ :ok = 1, :column = cCol, :desc = lDesc, :rows = nTableView ])

# =========================================================== 5. paging
# cJson: [ :from = 1, :count = 25 ]
#
# A table shows a screenful, never 20,000 rows. This is the only function
# that hands row data back, and it hands back one page of it.
func TablePage cJson
	aIn = JsonDecode(cJson)
	nFrom = 1  nCount = 25
	for i = 1 to len(aIn)
		if aIn[i][1] = "from"   nFrom = aIn[i][2]   ok
		if aIn[i][1] = "count"  nCount = aIn[i][2]  ok
	next
	if nFrom < 1  nFrom = 1  ok
	nTo = nFrom + nCount - 1
	if nTo > nTableView  nTo = nTableView  ok

	TableIndex(1)
	aOut = []
	nCols = len(aTableData)
	for k = nFrom to nTo
		i = aTableView[k]
		aRow = []
		for c = 1 to nCols
			aRow + aTableData[c][i]
		next
		aOut + aRow
	next
	return JsonEncode(aOut)

# One row of the view, by position.
func TableRow nAt
	if nAt < 1 or nAt > nTableView
		return JsonEncode([ :ok = 0, :problem = "out of range" ])
	ok
	TableIndex(1)
	i = aTableView[nAt]
	aRow = []
	for c = 1 to len(aTableData)
		aRow + aTableData[c][i]
	next
	return JsonEncode([ :ok = 1, :at = nAt, :row = aRow ])

# ======================================================== 6. aggregating
# cJson: [ :column = "amount" ]
#    or: [ :column = "amount", :where = [ [ :column = "amount",
#                                           :op = "gt", :value = 0 ] ] ]
#
# Over the CURRENT view, so it answers "what am I looking at" rather than
# "what is in the table". Non-numeric cells are counted and skipped, never
# silently treated as zero.
#
# `where` totals a subset WITHOUT disturbing the view. Added in 1.1 because
# a register needed "the sum of the deposits that count, and how many did
# not" — and doing that by filtering twice and filtering back turns one
# pass into three, on a table where one pass is the budget.
func TableAggregate cJson
	aIn = JsonDecode(cJson)
	cCol = ""
	aWhere = []
	for i = 1 to len(aIn)
		if aIn[i][1] = "column"  cCol = "" + aIn[i][2]  ok
		if aIn[i][1] = "where"   aWhere = aIn[i][2]     ok
	next
	nC = TableColumnOf(cCol)
	if nC = 0
		return JsonEncode([ :ok = 0, :problem = "no column called " + cCol ])
	ok

	# resolve the tests once, not per row
	aTests = []
	for i = 1 to len(aWhere)
		cWCol = ""  cWOp = "eq"  pWVal = ""
		for j = 1 to len(aWhere[i])
			if aWhere[i][j][1] = "column"  cWCol = "" + aWhere[i][j][2]  ok
			if aWhere[i][j][1] = "op"      cWOp = "" + aWhere[i][j][2]   ok
			if aWhere[i][j][1] = "value"   pWVal = aWhere[i][j][2]       ok
		next
		nWC = TableColumnOf(cWCol)
		if nWC = 0
			return JsonEncode([ :ok = 0, :problem = "no column called " + cWCol ])
		ok
		nWCode = TableOpCode(cWOp)
		if nWCode = 0
			return JsonEncode([ :ok = 0, :problem = "no such op: " + cWOp ])
		ok
		aTests + [nWC, nWCode, pWVal]
	next

	TableIndex(1)
	nTests = len(aTests)

	# One test is the overwhelmingly common case ("the rows that count"),
	# and reaching into aTests[t][1..3] three times per row is three nested
	# list accesses that buy nothing. Hoist them.
	n1Col = 0  n1Op = 0  p1Val = ""
	if nTests = 1
		n1Col = aTests[1][1]
		n1Op = aTests[1][2]
		p1Val = aTests[1][3]
	ok

	nSum = 0  nMin = 0  nMax = 0  nGood = 0  nBad = 0
	for k = 1 to nTableView
		nRow = aTableView[k]
		lPass = 1
		if nTests = 1
			v = aTableData[n1Col][nRow]
			lPass = 0
			if n1Op = 1        lPass = (v = p1Val)
			but n1Op = 2       lPass = (v != p1Val)
			but n1Op = 3       lPass = (v > p1Val)
			but n1Op = 4       lPass = (v >= p1Val)
			but n1Op = 5       lPass = (v <= p1Val) and (v != p1Val)
			but n1Op = 6       lPass = (v <= p1Val)
			but n1Op = 7       lPass = (substr(lower("" + v), lower("" + p1Val)) > 0)
			but n1Op = 8       lPass = (left(lower("" + v), len("" + p1Val)) = lower("" + p1Val))
			ok
		but nTests > 1
			for t = 1 to nTests
				v = aTableData[aTests[t][1]][nRow]
				o = aTests[t][2]
				w = aTests[t][3]
				lOk = 0
				if o = 1        lOk = (v = w)
				but o = 2       lOk = (v != w)
				but o = 3       lOk = (v > w)
				but o = 4       lOk = (v >= w)
				but o = 5       lOk = (v <= w) and (v != w)
				but o = 6       lOk = (v <= w)
				but o = 7       lOk = (substr(lower("" + v), lower("" + w)) > 0)
				but o = 8       lOk = (left(lower("" + v), len("" + w)) = lower("" + w))
				ok
				if lOk = 0
					lPass = 0
					exit
				ok
			next
		ok
		if lPass = 0
			nBad = nBad + 1
			loop
		ok
		v = aTableData[nC][nRow]
		if not isnumber(v)
			nBad = nBad + 1
			loop
		ok
		if nGood = 0
			nMin = v
			nMax = v
		ok
		nGood = nGood + 1
		nSum = nSum + v
		if v < nMin  nMin = v  ok
		if v > nMax  nMax = v  ok
	next
	nAvg = 0
	if nGood > 0
		nAvg = nSum / nGood
	ok
	return JsonEncode([ :ok = 1, :column = cCol, :count = nGood,
			    :skipped = nBad, :sum = nSum, :min = nMin,
			    :max = nMax, :avg = nAvg ])

# ========================================================== 7. grouping
# cJson: [ :by = "member", :value = "amount", :top = 5 ]
#
# The aggregate a dashboard shows: totals per group, biggest first. Over
# the current view, like everything else here.
func TableGroup cJson
	aIn = JsonDecode(cJson)
	cBy = ""  cVal = ""  nTop = 10
	for i = 1 to len(aIn)
		if aIn[i][1] = "by"     cBy = "" + aIn[i][2]   ok
		if aIn[i][1] = "value"  cVal = "" + aIn[i][2]  ok
		if aIn[i][1] = "top"    nTop = aIn[i][2]       ok
	next
	nB = TableColumnOf(cBy)
	if nB = 0
		return JsonEncode([ :ok = 0, :problem = "no column called " + cBy ])
	ok
	nV = 0
	if len(cVal) > 0
		nV = TableColumnOf(cVal)
		if nV = 0
			return JsonEncode([ :ok = 0, :problem = "no column called " + cVal ])
		ok
	ok

	TableIndex(1)
	# Finding the group for a row, WITHOUT the obvious trick.
	#
	# A Ring list of [key, value] pairs supports aList["key"], and it is
	# genuinely fast for keys that exist: 50,000 hits cost 14, 15 and 16 ms
	# against maps of 20, 200 and 2,000 entries. Flat.
	#
	# But reading a key that is NOT there **appends it**. A lookup used as
	# an existence test is a write, so the map grows by one on every miss
	# and every row looks new. Measured: one read of a missing key took a
	# one-entry list to two entries. This function grouped five rows into
	# eight groups before that was found.
	#
	# find(aList, key, 1) searches column 1, returns 0 for a miss, and does
	# not mutate. It costs 6 ms for 20 groups and 25 ms for 200 over 20,000
	# rows — linear in the group count, which for a dashboard is nothing.
	aSeen = []
	aName = []  aTotal = []  aCount = []
	nGroups = 0
	for k = 1 to nTableView
		i = aTableView[k]
		cKey = "" + aTableData[nB][i]
		nSlot = 0
		nAt = find(aSeen, cKey, 1)
		if nAt > 0
			nSlot = aSeen[nAt][2]
		ok
		if nSlot = 0
			aName + cKey
			aTotal + 0
			aCount + 0
			nGroups = nGroups + 1
			nSlot = nGroups
			aSeen + [ cKey, nSlot ]
		ok
		aCount[nSlot] = aCount[nSlot] + 1
		if nV > 0
			v = aTableData[nV][i]
			if isnumber(v)
				aTotal[nSlot] = aTotal[nSlot] + v
			ok
		ok
	next

	aRank = []
	for g = 1 to nGroups
		aRank + [ aTotal[g], aName[g], aCount[g] ]
	next
	if nGroups > 0
		aRank = reverse(sort(aRank, 1))
	ok
	if nTop > nGroups  nTop = nGroups  ok
	aOut = []
	for g = 1 to nTop
		aOut + [ :group = aRank[g][2], :total = aRank[g][1], :count = aRank[g][3] ]
	next
	return JsonEncode(aOut)

# =========================================================== 8. writing
# cJson: [ <cell>, <cell>, ... ] — one row, in column order.
#
# Marks the index stale rather than rebuilding it. Rebuilding here would
# cost O(n) per append, which on 20,000 rows is 824 us a row — worse than
# the problem the index solves.
func TableAppend cJson
	aRow = JsonDecode(cJson)
	nC = len(aTableData)
	if len(aRow) != nC
		return JsonEncode([ :ok = 0,
				    :problem = "expected " + nC + " values, got " + len(aRow) ])
	ok
	for c = 1 to nC
		aTableData[c] + aRow[c]
	next
	nTableRows = nTableRows + 1
	aTableView + nTableRows
	nTableView = nTableView + 1
	lTableIndexed = 0
	return JsonEncode([ :ok = 1, :rows = nTableRows ])

# Change one cell, by view position.
func TableSet cJson
	aIn = JsonDecode(cJson)
	nAt = 0  cCol = ""  pVal = ""
	for i = 1 to len(aIn)
		if aIn[i][1] = "at"      nAt = aIn[i][2]        ok
		if aIn[i][1] = "column"  cCol = "" + aIn[i][2]  ok
		if aIn[i][1] = "value"   pVal = aIn[i][2]       ok
	next
	nC = TableColumnOf(cCol)
	if nC = 0
		return JsonEncode([ :ok = 0, :problem = "no column called " + cCol ])
	ok
	if nAt < 1 or nAt > nTableView
		return JsonEncode([ :ok = 0, :problem = "out of range" ])
	ok
	aTableData[nC][ aTableView[nAt] ] = pVal
	# a cell assignment is not a structural change, so the index survives
	return JsonEncode([ :ok = 1 ])

# ==================================================== 9. save and restore
# The page owns storage; this owns the shape of what is stored.
func TableSnapshot p
	return JsonEncode([ :columns = aTableCols, :data = aTableData,
			    :rows = nTableRows ])

func TableRestore cJson
	if not isstring(cJson) or len(cJson) = 0
		return 0
	ok
	aIn = JsonDecode(cJson)
	for i = 1 to len(aIn)
		if aIn[i][1] = "columns"
			aTableCols = aIn[i][2]
		but aIn[i][1] = "data"
			aTableData = aIn[i][2]
		but aIn[i][1] = "rows"
			nTableRows = aIn[i][2]
		ok
	next
	TableAll(1)
	lTableIndexed = 0
	return nTableRows
