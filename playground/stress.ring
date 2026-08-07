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
# TWO RING RULES THIS CODE OBEYS, both learned the hard way:
#   Assignment COPIES — `o = aList[i]` gives a copy, so writing to it
#   changes nothing; mutate through the list: aList[i][2] = ...
#   Arguments COPY too — a helper taking a record duplicates it on every
#   call, so field reading is inline below rather than in a tidy function.

func LedgerRun cJson
	aTask = []          # [name, milliseconds, what it produced]

	# --- TASK 1 --------------------------------------------- parse JSON
	nT = clock()
	aDeposits = JsonDecode(cJson)
	nMs = (clock() - nT) / clockspersecond() * 1000
	add(aTask, ["Parse the JSON payload", nMs, "" + len(aDeposits) + " deposits"])

	# --- TASK 2 ------------------------------- read the fields, one pass
	# JsonDecode gives each record as a pair-list: [["id",1],["member","m03"]…]
	# so reading a field means walking those pairs. Done once, into columns.
	nT = clock()
	aMemberOf = []
	aRoundOf = []
	aAmountOf = []
	aStatusOf = []
	aIdOf = []
	for aRec in aDeposits
		nId = 0  cMember = ""  nRound = 0  nAmount = 0  cStatus = ""
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
		add(aIdOf, nId)
		add(aMemberOf, cMember)
		add(aRoundOf, nRound)
		add(aAmountOf, nAmount)
		add(aStatusOf, cStatus)
	next
	nMs = (clock() - nT) / clockspersecond() * 1000
	add(aTask, ["Read the fields into columns", nMs, "" + len(aAmountOf) + " x 5 fields"])

	# --- TASK 3 ------------------------ reject invalid deposits (the norm)
	nT = clock()
	aOk = []
	nBad = 0
	aBadSample = []
	for i = 1 to len(aAmountOf)
		if isnumber(aAmountOf[i]) and aAmountOf[i] > 0
			add(aOk, i)
		else
			nBad = nBad + 1
			if len(aBadSample) < 12
				add(aBadSample, "#" + aIdOf[i] + " " + aMemberOf[i] + " (" + aAmountOf[i] + ")")
			ok
		ok
	next
	nMs = (clock() - nT) / clockspersecond() * 1000
	add(aTask, ["Reject invalid deposits", nMs, "" + nBad + " rejected, " + len(aOk) + " kept"])

	# --- TASK 4 ------------------------------------- add up all the money
	nT = clock()
	nGrand = 0
	for i in aOk
		nGrand = nGrand + aAmountOf[i]
	next
	nMs = (clock() - nT) / clockspersecond() * 1000
	add(aTask, ["Add up all the money", nMs, "" + nGrand])

	# --- TASK 5 ----------------------------------------- total each round
	nT = clock()
	aRounds = []
	for i in aOk
		nR = aRoundOf[i]
		while len(aRounds) < nR
			add(aRounds, 0)
		end
		aRounds[nR] = aRounds[nR] + aAmountOf[i]
	next
	nMs = (clock() - nT) / clockspersecond() * 1000
	add(aTask, ["Total each round", nMs, "" + len(aRounds) + " rounds"])

	# --- TASK 6 ------------------------- total each member, rank the top 5
	nT = clock()
	aMembers = []                      # rows of [name, total, count, biggest]
	for i in aOk
		cM = aMemberOf[i]
		nA = aAmountOf[i]
		nSlot = 0
		for k = 1 to len(aMembers)
			if aMembers[k][1] = cM
				nSlot = k
				exit
			ok
		next
		if nSlot = 0
			add(aMembers, [cM, 0, 0, 0])
			nSlot = len(aMembers)
		ok
		# mutate THROUGH the list — see the note at the top of this file
		aMembers[nSlot][2] = aMembers[nSlot][2] + nA
		aMembers[nSlot][3] = aMembers[nSlot][3] + 1
		if nA > aMembers[nSlot][4]
			aMembers[nSlot][4] = nA
		ok
	next
	# rank by total: sort ascending on column 2, then flip
	aRank = []
	for k = 1 to len(aMembers)
		add(aRank, [aMembers[k][2], aMembers[k][1], aMembers[k][3], aMembers[k][4]])
	next
	aRank = reverse(sort(aRank, 1))
	nMs = (clock() - nT) / clockspersecond() * 1000
	# an empty ledger has no leader — reading aRank[1] here crashed until
	# the driver ran LedgerRun on "[]"
	cLead = "-"
	if len(aRank) > 0
		cLead = aRank[1][2]
	ok
	add(aTask, ["Total each member, rank top 5", nMs,
		    "" + len(aMembers) + " members, leader " + cLead])

	# --- TASK 7 -------------------------------------------- write the report
	nT = clock()
	cReport = "TONTINE LEDGER" + nl
	cReport += "==============" + nl + nl
	cReport += "deposits received : " + len(aAmountOf) + nl
	cReport += "accepted          : " + len(aOk) + nl
	cReport += "rejected          : " + nBad + nl
	cReport += "grand total       : " + nGrand + nl + nl
	cReport += "MEMBER        TOTAL      DEPOSITS   BIGGEST" + nl
	for k = 1 to len(aRank)
		cLine = aRank[k][2]
		while len(cLine) < 14  cLine += " "  end
		cLine += "" + aRank[k][1]
		while len(cLine) < 25  cLine += " "  end
		cLine += "" + aRank[k][3]
		while len(cLine) < 36  cLine += " "  end
		cReport += cLine + aRank[k][4] + nl
	next
	cReport += nl + "ROUND TOTALS" + nl
	for k = 1 to len(aRounds)
		cLine = "  round " + k
		while len(cLine) < 12  cLine += " "  end
		cReport += cLine + ": " + aRounds[k] + nl
	next
	if nBad > 0
		cReport += nl + "REJECTED (norm: amount must be > 0)" + nl
		for cB in aBadSample
			cReport += "  " + cB + nl
		next
		if nBad > len(aBadSample)
			cReport += "  ... and " + (nBad - len(aBadSample)) + " more" + nl
		ok
	ok
	nMs = (clock() - nT) / clockspersecond() * 1000
	add(aTask, ["Write the report", nMs, "" + len(cReport) + " characters"])

	# --- hand everything back so the page can compare it to JavaScript's
	aTop = []
	for k = 1 to 5
		if k <= len(aRank)
			add(aTop, [ :member = aRank[k][2], :total = aRank[k][1],
				    :count = aRank[k][3], :biggest = aRank[k][4] ])
		ok
	next
	return JsonEncode([
		:seen     = len(aAmountOf),
		:accepted = len(aOk),
		:rejected = nBad,
		:grand    = nGrand,
		:members  = len(aMembers),
		:rounds   = aRounds,
		:top      = aTop,
		:report   = cReport,
		:tasks    = aTask
	])
