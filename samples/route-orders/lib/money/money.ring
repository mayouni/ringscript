# RingScript Money — the Ring half.
#
# Money as INTEGER MINOR UNITS, and nothing else. Ring numbers are IEEE
# doubles, and 0.1 + 0.2 is not 0.3 in a double; it is exactly 30 centimes
# here, because a centime is an integer and integers are exact in a double
# far past any till. No DOM, no fetch, no storage: this file decides what
# an amount IS, how amounts combine, and where a rounding decision happens
# -- always explicitly, never as a side effect of representation.
#
# A money value is a pair-list, JSON-friendly by construction:
#
#     [ :m = 1250, :c = "EUR" ]        <->      {"m":1250,"c":"EUR"}
#
# so it travels through outbox payloads and snapshots unchanged.
#
# Two rules with teeth:
#   - CURRENCIES NEVER MIX SILENTLY. Adding XOF to EUR raises. A silent
#     conversion is a business decision nobody made.
#   - THE STRING PATH IS THE EXACT ONE. MoneyOf("12.50","EUR") parses
#     digits and cannot misrepresent; MoneyOf(12.50,"EUR") rides a double
#     and rounds half-up, which is fine for computed values and wrong for
#     typed ones. Parse what a person typed; round what a formula made.
#
# Every error raises with a message starting "money:". Under RingScript
# the eval shim reports it cleanly; under native Ring it stops the program,
# which is what a programming error should do.

# --- the currency table: [ code, minor per major, decimals, symbol,
#     decimal separator, group separator, symbol after the amount ]
aMoneyCur = [
	[ "XOF", 1,    0, "F",  ",", " ", 1 ],
	[ "EUR", 100,  2, "€",  ",", " ", 1 ],
	[ "USD", 100,  2, "$",  ".", ",", 0 ],
	[ "GBP", 100,  2, "£",  ".", ",", 0 ],
	[ "TND", 1000, 3, "DT", ",", " ", 1 ],
	[ "MAD", 100,  2, "DH", ",", " ", 1 ],
	[ "DZD", 100,  2, "DA", ",", " ", 1 ]
]

# ------------------------------------------------------------ the table
func MoneyCurRow cCode
	for i = 1 to len(aMoneyCur)
		if aMoneyCur[i][1] = cCode
			return aMoneyCur[i]
		ok
	next
	raise("money: unknown currency " + cCode +
	      " -- register it with MoneyCurrencyAdd first")

# cJson: [ "code", minor_per_major, decimals, "symbol", "decsep", "groupsep", after ]
func MoneyCurrencyAdd cJson
	aRow = JsonDecode(cJson)
	if not islist(aRow) or len(aRow) < 7
		raise("money: MoneyCurrencyAdd needs the seven-field row")
	ok
	for i = 1 to len(aMoneyCur)
		if aMoneyCur[i][1] = aRow[1]
			aMoneyCur[i] = aRow
			return aRow[1]
		ok
	next
	aMoneyCur + aRow
	return aRow[1]

# --------------------------------------------------------- construction
func MoneyOf vAmount, cCur
	aRow = MoneyCurRow(cCur)
	if isstring(vAmount)
		return MoneyParse(vAmount, cCur)
	ok
	if not isnumber(vAmount)
		raise("money: MoneyOf takes a number or a string")
	ok
	return [ :m = MoneyHalfUp(vAmount * aRow[2]), :c = cCur ]

func MoneyFromMinor nMinor, cCur
	MoneyCurRow(cCur)
	if not isnumber(nMinor) or nMinor != floor(nMinor)
		raise("money: minor units are integers")
	ok
	return [ :m = nMinor, :c = cCur ]

# Parse what a person typed -- EXACTLY. Group separators and plain spaces
# are ignored; either "." or "," is the decimal mark, but not both in one
# amount; more decimals than the currency carries is a refusal, not a
# silent rounding, because rounding somebody's typed price is a decision.
func MoneyParse cText, cCur
	aRow = MoneyCurRow(cCur)
	cInt = ""  cFrac = ""  bFrac = 0  bNeg = 0  cSep = ""
	for i = 1 to len(cText)
		ch = cText[i]
		if ch = " " or ch = char(160)
			loop
		but ch = "-"
			if i != 1
				raise("money: misplaced minus in " + cText)
			ok
			bNeg = 1
		but ch = "." or ch = ","
			if bFrac
				raise("money: two decimal marks in " + cText)
			ok
			bFrac = 1
			cSep = ch
		but isdigit(ch)
			if bFrac
				cFrac = cFrac + ch
			else
				cInt = cInt + ch
			ok
		else
			raise("money: unexpected " + ch + " in " + cText)
		ok
	next
	# "1,500" with a 3-digit tail and comma-as-group habit is ambiguous by
	# construction; this parser is strict instead of clever: one mark, and
	# it is the decimal mark. Strip group separators before parsing.
	if len(cInt) = 0 and len(cFrac) = 0
		raise("money: nothing to parse in " + cText)
	ok
	if len(cFrac) > aRow[3]
		raise("money: " + cText + " carries more decimals than " + cCur +
		      " has (" + aRow[3] + ")")
	ok
	while len(cFrac) < aRow[3]
		cFrac = cFrac + "0"
	end
	nMinor = 0
	cWhole = cInt + cFrac
	for i = 1 to len(cWhole)
		nMinor = nMinor * 10 + number(cWhole[i])
	next
	if bNeg
		nMinor = -nMinor
	ok
	return [ :m = nMinor, :c = cCur ]

# --------------------------------------------------------------- access
func MoneyMinor m
	return m[:m]

func MoneyCur m
	return m[:c]

# Canonical text: dot decimal, exact decimals, no grouping -- for JSON,
# logs, and anything a machine reads back.
func MoneyToStr m
	aRow = MoneyCurRow(m[:c])
	return MoneyDigits(m[:m], aRow[3], ".", "")

# ----------------------------------------------------------- arithmetic
func MoneySameCur a, b
	if a[:c] != b[:c]
		raise("money: " + a[:c] + " and " + b[:c] +
		      " cannot mix -- convert deliberately first")
	ok
	return 1

func MoneyAdd a, b
	MoneySameCur(a, b)
	return [ :m = a[:m] + b[:m], :c = a[:c] ]

func MoneySub a, b
	MoneySameCur(a, b)
	return [ :m = a[:m] - b[:m], :c = a[:c] ]

func MoneyNegate m
	return [ :m = -m[:m], :c = m[:c] ]

# Multiply by a factor (a quantity, a rate). THE rounding decision of this
# library: half-up, away from zero, applied ONCE at the end. A chain of
# MoneyMul calls rounds at each step by design -- round late by keeping
# the factor composite: MoneyMul(m, nQty * nRate) not two calls.
func MoneyMul m, nFactor
	return [ :m = MoneyHalfUp(m[:m] * nFactor), :c = m[:c] ]

# Percent stays in integer arithmetic as long as possible: minor * pct is
# exact in a double far beyond any ledger, so 19% of 143 500 F is 27 265 F
# by arithmetic, not by luck.
func MoneyPercent m, nPct
	return [ :m = MoneyHalfUp((m[:m] * nPct) / 100), :c = m[:c] ]

# ----------------------------------------------------------- allocation
# The reason this library exists beyond add-and-round: split an amount by
# ratios so the parts sum EXACTLY to the whole -- largest-remainder, ties
# to the earlier part. Splitting 100 F three ways is 34 + 33 + 33, and no
# centime has ever gone missing between three people who can count.
func MoneyAllocate m, aRatios
	if not islist(aRatios) or len(aRatios) = 0
		raise("money: allocate needs a list of ratios")
	ok
	nTotal = m[:m]
	bNeg = 0
	if nTotal < 0
		bNeg = 1
		nTotal = -nTotal
	ok
	nR = 0
	for i = 1 to len(aRatios)
		if not isnumber(aRatios[i]) or aRatios[i] < 0
			raise("money: ratios are non-negative numbers")
		ok
		nR = nR + aRatios[i]
	next
	if nR = 0
		raise("money: the ratios sum to zero")
	ok
	aBase = []  aFrac = []
	nUsed = 0
	for i = 1 to len(aRatios)
		nShare = (nTotal * aRatios[i]) / nR
		nB = floor(nShare)
		aBase + nB
		aFrac + (nShare - nB)
		nUsed = nUsed + nB
	next
	nLeft = nTotal - nUsed
	while nLeft > 0
		nPick = 0  nBest = -1
		for i = 1 to len(aFrac)
			if aFrac[i] > nBest
				nBest = aFrac[i]
				nPick = i
			ok
		next
		aBase[nPick] = aBase[nPick] + 1
		aFrac[nPick] = -1
		nLeft = nLeft - 1
	end
	aOut = []
	for i = 1 to len(aBase)
		nV = aBase[i]
		if bNeg
			nV = -nV
		ok
		aOut + [ :m = nV, :c = m[:c] ]
	next
	return aOut

func MoneySplit m, nParts
	if not isnumber(nParts) or nParts < 1 or nParts != floor(nParts)
		raise("money: split needs a whole number of parts")
	ok
	aOnes = []
	for i = 1 to nParts
		aOnes + 1
	next
	return MoneyAllocate(m, aOnes)

# ----------------------------------------------------------- comparison
func MoneyCmp a, b
	MoneySameCur(a, b)
	if a[:m] < b[:m]  return -1  ok
	if a[:m] > b[:m]  return 1   ok
	return 0

func MoneyIsZero m
	return m[:m] = 0

# ------------------------------------------------------------ formatting
# For eyes, with the currency's own habits: "4 200 F", "12,50 €",
# "$1,234.56", "1,250 DT" (TND carries three decimals: "1,250").
func MoneyFormat m
	aRow = MoneyCurRow(m[:c])
	cBody = MoneyDigits(m[:m], aRow[3], aRow[5], aRow[6])
	if aRow[7] = 1
		return cBody + " " + aRow[4]
	ok
	# a leading symbol goes between the sign and the digits: -$5.00
	if left(cBody, 1) = "-"
		return "-" + aRow[4] + substr(cBody, 2)
	ok
	return aRow[4] + cBody

# minor units -> grouped digits with a decimal tail. The one string
# builder both MoneyToStr and MoneyFormat share, so they cannot disagree.
func MoneyDigits nMinor, nDec, cDecSep, cGroupSep
	bNeg = 0
	if nMinor < 0
		bNeg = 1
		nMinor = -nMinor
	ok
	cRaw = "" + nMinor
	# a large double prints plainly for any realistic ledger; guard anyway
	while len(cRaw) < nDec + 1
		cRaw = "0" + cRaw
	end
	cIntPart = left(cRaw, len(cRaw) - nDec)
	cFracPart = right(cRaw, nDec)
	cGrouped = ""
	nCount = 0
	for i = len(cIntPart) to 1 step -1
		cGrouped = cIntPart[i] + cGrouped
		nCount = nCount + 1
		if nCount % 3 = 0 and i > 1 and len(cGroupSep) > 0
			cGrouped = cGroupSep + cGrouped
		ok
	next
	cOut = cGrouped
	if nDec > 0
		cOut = cOut + cDecSep + cFracPart
	ok
	if bNeg
		cOut = "-" + cOut
	ok
	return cOut

# ------------------------------------------------- rounding, half-up
# Away from zero at exactly .5 -- the rule a shopkeeper expects. ONE
# function so the whole library rounds one way, and a different policy is
# a deliberate edit here, not a drift between call sites.
func MoneyHalfUp nV
	if nV >= 0
		return floor(nV + 0.5)
	ok
	return -floor(-nV + 0.5)

# ------------------------------------------ bridge shims (single JSON arg)
# ring.call carries ONE argument, so the browser half packs multi-argument
# calls into a JSON array and comes through these.
func MoneyOfQ cJson
	aIn = JsonDecode(cJson)
	return JsonEncode(MoneyOf(aIn[1], aIn[2]))

func MoneyParseQ cJson
	aIn = JsonDecode(cJson)
	return JsonEncode(MoneyParse(aIn[1], aIn[2]))

func MoneyFormatQ cJson
	aIn = JsonDecode(cJson)
	return MoneyFormat([ :m = aIn[1], :c = aIn[2] ])
