# stress.ring — the Ring player in a side-by-side comparison.
#
# THE GOAL
#   Can Ring, running in a browser as WebAssembly, do a real data job?
#   To answer honestly you need something to compare against, so the same
#   seven tasks are done twice: once here in Ring, once in JavaScript
#   (stress.html). Same input, same tasks, same order. The page shows both
#   answers next to each other, so you can see they agree, and both
#   timings, so you can see what Ring costs.
#
# THE JOB — a tontine: a savings circle where members put money into
#   numbered rounds. Given a list of deposits from an API, produce the
#   ledger: what came in, from whom, in which round, and who leads.
#
# THE SEVEN TASKS
#   1  parse the JSON payload
#   2  read the fields into columns
#   3  reject invalid deposits   (the ZQL norm: amount must be > 0)
#   4  add up all the money
#   5  total each round
#   6  total each member, and rank the top 5
#   7  write the report
#
# Each task is timed separately and kept as its own pass over the data.
# A production app would fuse tasks 3-6 into one walk; they are kept apart
# here because the point is to SHOW each task, and because JavaScript is
# doing them the same way — a fair comparison beats a fast one.
#
# FIVE RING RULES THIS CODE OBEYS. The first two were learned the hard way
# here; the rest are how you write a hot loop in Ring.
#
#   1. Assignment COPIES. `aRec = aDeposits[i]` duplicates the whole
#      record. Index straight through — aDeposits[i][j][1] — and nothing
#      is copied. Same reason a value is mutated in place through the
#      list: aMembers[k][2] = ...
#   2. Arguments COPY too, so a tidy FieldOf(aRec, "amount") helper would
#      duplicate the record on every call. Field reading is inline.
#   3. Index the loop, do not walk it. `for x in aList` hands you a copy
#      of each item; `for i = 1 to n` with aList[i] does not.
#   4. Hoist the length. `for i = 1 to len(aList)` re-evaluates len() on
#      every iteration; take it once into a variable first.
#   5. Append with `+`, not add(). `aList + item` is the operator form,
#      and it appends a sublist as ONE item, so nested rows work.

func LedgerRun cJson
	aTask = []          # rows of [name, milliseconds, what it produced]

	# --- TASK 1 --------------------------------------------- parse JSON
	nT = clock()
	aDeposits = JsonDecode(cJson)
	nMs = (clock() - nT) / clockspersecond() * 1000
	nCount = len(aDeposits)
	aTask + ["Parse the JSON payload", nMs, "" + nCount + " deposits"]

	# --- TASK 2 ------------------------------- read the fields, one pass
	# JsonDecode gives each record as a pair-list: [["id",1],["member","m03"]…]
	# so reading a field means walking those pairs. Done once, into columns,
	# indexing straight into the record so nothing is duplicated.
	nT = clock()
	aIdOf = []
	aMemberOf = []
	aRoundOf = []
	aAmountOf = []
	aStatusOf = []
	for i = 1 to nCount
		nId = 0  cMember = ""  nRound = 0  nAmount = 0  cStatus = ""
		nFields = len(aDeposits[i])
		for j = 1 to nFields
			cK = aDeposits[i][j][1]
			if cK = "member"
				cMember = aDeposits[i][j][2]
			but cK = "round"
				nRound = aDeposits[i][j][2]
			but cK = "amount"
				nAmount = aDeposits[i][j][2]
			but cK = "status"
				cStatus = aDeposits[i][j][2]
			but cK = "id"
				nId = aDeposits[i][j][2]
			ok
		next
		aIdOf + nId
		aMemberOf + cMember
		aRoundOf + nRound
		aAmountOf + nAmount
		aStatusOf + cStatus
	next
	nMs = (clock() - nT) / clockspersecond() * 1000
	aTask + ["Read the fields into columns", nMs, "" + nCount + " x 5 fields"]

	# --- TASK 3 ------------------------ reject invalid deposits (the norm)
	nT = clock()
	aOk = []
	nBad = 0
	aBadSample = []
	for i = 1 to nCount
		if isnumber(aAmountOf[i]) and aAmountOf[i] > 0
			aOk + i
		else
			nBad = nBad + 1
			if len(aBadSample) < 12
				aBadSample + ("#" + aIdOf[i] + " " + aMemberOf[i] + " (" + aAmountOf[i] + ")")
			ok
		ok
	next
	nOk = len(aOk)
	nMs = (clock() - nT) / clockspersecond() * 1000
	aTask + ["Reject invalid deposits", nMs, "" + nBad + " rejected, " + nOk + " kept"]

	# --- TASK 4 ------------------------------------- add up all the money
	nT = clock()
	nGrand = 0
	for k = 1 to nOk
		nGrand = nGrand + aAmountOf[aOk[k]]
	next
	nMs = (clock() - nT) / clockspersecond() * 1000
	aTask + ["Add up all the money", nMs, "" + nGrand]

	# --- TASK 5 ----------------------------------------- total each round
	nT = clock()
	aRounds = []
	nRoundsSeen = 0
	for k = 1 to nOk
		i = aOk[k]
		nR = aRoundOf[i]
		while nRoundsSeen < nR
			aRounds + 0
			nRoundsSeen = nRoundsSeen + 1
		end
		aRounds[nR] = aRounds[nR] + aAmountOf[i]
	next
	nMs = (clock() - nT) / clockspersecond() * 1000
	aTask + ["Total each round", nMs, "" + nRoundsSeen + " rounds"]

	# --- TASK 6 ------------------------- total each member, rank the top 5
	nT = clock()
	aMembers = []                      # rows of [name, total, count, biggest]
	nMembers = 0
	for k = 1 to nOk
		i = aOk[k]
		cM = aMemberOf[i]
		nA = aAmountOf[i]
		nSlot = 0
		for m = 1 to nMembers
			if aMembers[m][1] = cM
				nSlot = m
				exit
			ok
		next
		if nSlot = 0
			aMembers + [cM, 0, 0, 0]
			nMembers = nMembers + 1
			nSlot = nMembers
		ok
		# mutate THROUGH the list — see rule 1 at the top of this file
		aMembers[nSlot][2] = aMembers[nSlot][2] + nA
		aMembers[nSlot][3] = aMembers[nSlot][3] + 1
		if nA > aMembers[nSlot][4]
			aMembers[nSlot][4] = nA
		ok
	next
	# rank by total: sort ascending on column 1 of the key rows, then flip
	aRank = []
	for m = 1 to nMembers
		aRank + [aMembers[m][2], aMembers[m][1], aMembers[m][3], aMembers[m][4]]
	next
	if nMembers > 0
		aRank = reverse(sort(aRank, 1))
	ok
	nMs = (clock() - nT) / clockspersecond() * 1000
	# an empty ledger has no leader — reading aRank[1] here crashed until
	# the driver ran LedgerRun on "[]"
	cLead = "-"
	if nMembers > 0
		cLead = aRank[1][2]
	ok
	aTask + ["Total each member, rank top 5", nMs,
		 "" + nMembers + " members, leader " + cLead]

	# --- TASK 7 -------------------------------------------- write the report
	nT = clock()
	cReport = "TONTINE LEDGER" + nl
	cReport += "==============" + nl + nl
	cReport += "deposits received : " + nCount + nl
	cReport += "accepted          : " + nOk + nl
	cReport += "rejected          : " + nBad + nl
	cReport += "grand total       : " + nGrand + nl + nl
	cReport += "MEMBER        TOTAL      DEPOSITS   BIGGEST" + nl
	nRankLen = len(aRank)
	for k = 1 to nRankLen
		cLine = aRank[k][2]
		while len(cLine) < 14  cLine += " "  end
		cLine += "" + aRank[k][1]
		while len(cLine) < 25  cLine += " "  end
		cLine += "" + aRank[k][3]
		while len(cLine) < 36  cLine += " "  end
		cReport += cLine + aRank[k][4] + nl
	next
	cReport += nl + "ROUND TOTALS" + nl
	for k = 1 to nRoundsSeen
		cLine = "  round " + k
		while len(cLine) < 12  cLine += " "  end
		cReport += cLine + ": " + aRounds[k] + nl
	next
	if nBad > 0
		cReport += nl + "REJECTED (norm: amount must be > 0)" + nl
		nSample = len(aBadSample)
		for k = 1 to nSample
			cReport += "  " + aBadSample[k] + nl
		next
		if nBad > nSample
			cReport += "  ... and " + (nBad - nSample) + " more" + nl
		ok
	ok
	nMs = (clock() - nT) / clockspersecond() * 1000
	aTask + ["Write the report", nMs, "" + len(cReport) + " characters"]

	# --- hand everything back so the page can compare it to JavaScript's
	aTop = []
	nTop = 5
	if nRankLen < nTop
		nTop = nRankLen
	ok
	for k = 1 to nTop
		aTop + [ :member = aRank[k][2], :total = aRank[k][1],
			 :count = aRank[k][3], :biggest = aRank[k][4] ]
	next
	return JsonEncode([
		:seen     = nCount,
		:accepted = nOk,
		:rejected = nBad,
		:grand    = nGrand,
		:members  = nMembers,
		:rounds   = aRounds,
		:top      = aTop,
		:report   = cReport,
		:tasks    = aTask
	])
