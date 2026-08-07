# stress.ring — a tontine ledger, written the way a Ring programmer writes.
#
# A savings circle: members put money into numbered rounds. This is the
# data-intensive path a real page walks — take a JSON payload from an API,
# validate it, aggregate it, rank it, report it, hand a summary back — at a
# size (50,000 deposits by default) where every shortcut shows.
#
# Ordinary Ring: lists, a class, for/in, sort, string concatenation. No
# tricks, because the point is what ordinary Ring costs. Every answer is
# checked against the same answer computed independently in JavaScript
# (tests/stress-app.js) — a stress test without an oracle is a stopwatch.
#
# TWO RING RULES SHAPE THIS CODE, and both were learned the hard way here:
#
#   1. Assignment COPIES. `oM = aMembers[i]` hands you a copy, so writing
#      oM.lmTotal updates nothing. Mutating in place means going through
#      the list every time: aMembers[i].lmTotal = ...
#   2. Arguments COPY too. A helper like FieldOf(aRec, "amount") duplicates
#      the whole record on every call — four calls per deposit is four
#      copies of it. So field extraction below is inline, reading each
#      record in ONE pass.
#
# Neither is a defect; both are what value semantics cost, and an app at
# this size has to know them.

func StressRun cJson
	aPhase = []

	# --- 1. decode the payload (the C codec, on a megabyte of JSON)
	nT = clock()
	aDeposits = JsonDecode(cJson)
	add(aPhase, ["decode", (clock() - nT) / clockspersecond() * 1000])

	# --- 2. one walk: validate, and accumulate members, rounds, statuses
	nT = clock()
	aMembers = []
	aRounds = []
	aStatus = []
	aBad = []
	nBad = 0
	nGrand = 0
	nSeen = 0

	for aRec in aDeposits
		nId = 0  cMember = ""  nRound = 0  nAmount = 0  cStatus = ""
		# one pass over the record's pairs — see rule 2 above
		for aPair in aRec
			cK = aPair[1]
			if cK = "member"
				cMember = aPair[2]
			but cK = "round"
				nRound = aPair[2]
			but cK = "amount"
				nAmount = aPair[2]
			but cK = "status"
				cStatus = aPair[2]
			but cK = "id"
				nId = aPair[2]
			ok
		next
		nSeen = nSeen + 1

		# the ZQL norm positive_deposit: RULE amount > 0
		if not isnumber(nAmount) or nAmount <= 0
			nBad = nBad + 1
			# aBad is a SAMPLE for the report, capped on purpose — the
			# count must come from nBad, not from len(aBad). Deriving it
			# from the capped list was a real bug here, caught by the
			# JavaScript oracle at 50,000 records and not at 5,000.
			if len(aBad) < 25
				add(aBad, "" + nId + ":" + cMember)
			ok
			loop
		ok

		# find or create the member's row, then mutate it IN THE LIST
		nSlot = 0
		for i = 1 to len(aMembers)
			if aMembers[i].lmName = cMember
				nSlot = i
				exit
			ok
		next
		if nSlot = 0
			oNew = new LedgerMember
			oNew.lmName = cMember
			oNew.lmTotal = 0
			oNew.lmCount = 0
			oNew.lmBiggest = 0
			add(aMembers, oNew)
			nSlot = len(aMembers)
		ok
		aMembers[nSlot].lmTotal = aMembers[nSlot].lmTotal + nAmount
		aMembers[nSlot].lmCount = aMembers[nSlot].lmCount + 1
		if nAmount > aMembers[nSlot].lmBiggest
			aMembers[nSlot].lmBiggest = nAmount
		ok

		while len(aRounds) < nRound
			add(aRounds, 0)
		end
		aRounds[nRound] = aRounds[nRound] + nAmount

		nFound = 0
		for i = 1 to len(aStatus)
			if aStatus[i][1] = cStatus
				aStatus[i][2] = aStatus[i][2] + 1
				nFound = 1
				exit
			ok
		next
		if nFound = 0
			add(aStatus, [cStatus, 1])
		ok

		nGrand = nGrand + nAmount
	next
	add(aPhase, ["aggregate", (clock() - nT) / clockspersecond() * 1000])

	# --- 3. rank the members
	nT = clock()
	aRank = []
	for i = 1 to len(aMembers)
		add(aRank, [aMembers[i].lmTotal, aMembers[i].lmName,
			    aMembers[i].lmCount, aMembers[i].lmBiggest])
	next
	# sort(list, nColumn) is the list-of-lists form; on a tie in column 1
	# Ring orders by the next column ascending (verified), which is why the
	# oracle breaks ties on the member name the same way.
	aRank = reverse(sort(aRank, 1))
	add(aPhase, ["rank", (clock() - nT) / clockspersecond() * 1000])

	# --- 4. render a text report (string growth)
	nT = clock()
	cReport = "TONTINE LEDGER" + nl + "==============" + nl
	cReport += "deposits seen : " + nSeen + nl
	cReport += "accepted      : " + (nSeen - nBad) + nl
	cReport += "grand total   : " + nGrand + nl + nl
	cReport += "member          total      n   biggest" + nl
	for i = 1 to len(aRank)
		cLine = aRank[i][2]
		while len(cLine) < 16  cLine += " "  end
		cLine += "" + aRank[i][1]
		while len(cLine) < 27  cLine += " "  end
		cLine += "" + aRank[i][3]
		while len(cLine) < 34  cLine += " "  end
		cReport += cLine + aRank[i][4] + nl
	next
	cReport += nl + "round totals" + nl
	for i = 1 to len(aRounds)
		cReport += "  round " + i + " : " + aRounds[i] + nl
	next
	add(aPhase, ["report", (clock() - nT) / clockspersecond() * 1000])

	# --- 5. hand a summary back (the C codec, encoding)
	aTop = []
	for i = 1 to 5
		if i <= len(aRank)
			add(aTop, [ :member = aRank[i][2], :total = aRank[i][1],
				    :count = aRank[i][3], :biggest = aRank[i][4] ])
		ok
	next
	aStatusOut = []
	for i = 1 to len(aStatus)
		add(aStatusOut, [ :status = aStatus[i][1], :count = aStatus[i][2] ])
	next
	# The encode is not self-timed — a phase cannot contain its own
	# duration. The driver measures total wall time; encode is the
	# remainder, and it is reported that way.
	return JsonEncode([
		:seen     = nSeen,
		:accepted = nSeen - nBad,
		:rejected = nBad,
		:badsample = len(aBad),
		:grand    = nGrand,
		:members  = len(aMembers),
		:top      = aTop,
		:rounds   = aRounds,
		:statuses = aStatusOut,
		:bad      = aBad,
		:report   = cReport,
		:phases   = aPhase
	])

# The class goes LAST on purpose: in Ring everything written after `class`
# belongs to it, so a func below this line would silently become a method
# instead of a global function.
class LedgerMember
	lmName
	lmTotal
	lmCount
	lmBiggest
