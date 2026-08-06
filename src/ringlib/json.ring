# ringlib/json.ring — pure-Ring JSON encode/decode for the RingScript bridge.
#
# Convention (REPAIR_PLAN.md §3): JSON object <-> Ring pair-list [ :key = v ],
# JSON array <-> plain list, string <-> string, number <-> number,
# true/false -> 1/0, null -> NULL.
#
# Note: Ring string literals have NO escape sequences, so "\n" below is a
# literal backslash followed by n — exactly the two characters JSON needs.
#
# PERFORMANCE, and why the code looks the way it does.
#
# substr(cBig, i, 1) costs time proportional to len(cBig), not 1. Reading a
# large string one byte at a time is therefore O(n^2): measured, a 512 KB
# scan took 14.4 seconds, and a 1 MB payload through ring.call — a page
# handing Ring a server response — froze the tab for over four minutes.
# Appending is not the problem; Ring's += is amortised and linear.
#
# So nothing here reads the source string directly. Both directions work
# through a sliding window: one substr per JSN_WINDOW bytes, then cheap
# indexing inside that small chunk. That is 24x faster at 512 KB and turns
# the curve back to near-linear. It is still O(n^2 / JSN_WINDOW) in the
# refills, which is the ceiling for pure Ring — the language offers no
# constant-time random access into a big string.

cJsnText = ""
nJsnPos = 0

# The reader window: cJsnWin holds JSN_WINDOW bytes of cJsnText starting at
# text position nJsnWinAt, so jsnAt() indexes a short string instead of a
# long one.
JSN_WINDOW = 4096
cJsnWin = ""
nJsnWinAt = 0
nJsnWinLen = 0

# Whether this JsonEncode has raised decimals(), and what to put back.
lJsnDecChanged = 0
nJsnSaveDec = 0

func JsonEncode v
	# decimals() is global VM state. The old code set 14 and restored a
	# hardcoded 2 for every number encoded, so any page that had chosen
	# decimals(6) silently got 2 back — and JsonEncode runs on the return of
	# every ring.call.
	#
	# Save and restore instead, but only if a fractional number actually
	# turns up: reading the setting costs a string(1/3) probe, and most
	# payloads (strings, ids, whole numbers) never need the precision at all.
	# The two locals are stacked so a JsonEncode nested inside one still
	# restores correctly.
	lWasChanged = lJsnDecChanged
	nWasSaved = nJsnSaveDec
	lJsnDecChanged = 0
	cJsnRes = jsnEnc(v)
	if lJsnDecChanged
		decimals(nJsnSaveDec)
	ok
	lJsnDecChanged = lWasChanged
	nJsnSaveDec = nWasSaved
	return cJsnRes

func JsonDecode cJson
	cJsnText = cJson
	nJsnPos = 1
	cJsnWin = ""
	nJsnWinAt = 0
	nJsnWinLen = 0
	return jsnValue()

# Ring has no getter for decimals(), but string(1/3) spells it out: the
# setting is exactly the number of digits after the point (and "0" when it
# is zero). Pure Ring, so this file stays portable to native ring.
func jsnDecimals
	cJsnProbe = string(1/3)
	if len(cJsnProbe) < 3
		return 0
	ok
	return len(cJsnProbe) - 2

# ---------------------------------------------------------------- encode

func jsnEnc v
	if isnumber(v)
		return jsnEncNumber(v)
	but isstring(v)
		return jsnEncString(v)
	but islist(v)
		if jsnIsPairList(v)
			return jsnEncObject(v)
		else
			return jsnEncArray(v)
		ok
	ok
	return "null"

func jsnIsPairList v
	if len(v) = 0
		return 0
	ok
	for item in v
		if not (islist(item) and len(item) = 2 and isstring(item[1]))
			return 0
		ok
	next
	return 1

# Whole numbers print exactly regardless of the setting, so the precision is
# raised lazily — on the first fraction encountered, and only once.
func jsnEncNumber n
	if n = floor(n)
		return string(floor(n))
	ok
	if lJsnDecChanged = 0
		nJsnSaveDec = jsnDecimals()
		decimals(14)
		lJsnDecChanged = 1
	ok
	cS = string(n)
	while len(cS) > 1 and right(cS, 1) = "0"
		cS = left(cS, len(cS) - 1)
	end
	if right(cS, 1) = "."
		cS = left(cS, len(cS) - 1)
	ok
	return cS

# Chunked for the reason at the top of this file: `c` may be megabytes, and
# substr(c, i, 1) per byte would be quadratic.
func jsnEncString c
	cQ = char(34)
	cB = "\"
	nLen = len(c)
	# Fast path. Almost every string crossing the bridge is short - a key, an
	# id, a name - and has nothing to escape. Scanning it and handing back the
	# original avoids both the chunk copy and the per-run rebuild, and beats
	# the byte-at-a-time loop this file used to have. Strings that DO need
	# escaping fall through to the general path below and are rescanned, which
	# is the rare case and worth the simpler code.
	if nLen <= JSN_WINDOW
		nI = 1
		while nI <= nLen
			nCode = ascii(c[nI])
			if nCode < 32 or nCode = 34 or nCode = 92
				exit
			ok
			nI += 1
		end
		if nI > nLen
			return cQ + c + cQ
		ok
	ok
	cOut = cQ
	nPos = 1
	while nPos <= nLen
		nTake = nLen - nPos + 1
		if nTake > JSN_WINDOW
			nTake = JSN_WINDOW
		ok
		cChunk = substr(c, nPos, nTake)
		nChunkLen = len(cChunk)
		if nChunkLen = 0
			exit
		ok
		nI = 1
		while nI <= nChunkLen
			# Copy the run up to the next byte that needs escaping in one
			# go. Bytes above 127 are UTF-8 continuation bytes and pass
			# through untouched, which is what keeps the encoding byte-exact.
			nRun = nI
			while nRun <= nChunkLen
				nCode = ascii(cChunk[nRun])
				if nCode < 32 or nCode = 34 or nCode = 92
					exit
				ok
				nRun += 1
			end
			if nRun > nI
				cOut += substr(cChunk, nI, nRun - nI)
				nI = nRun
			ok
			if nI > nChunkLen
				exit
			ok
			nCode = ascii(cChunk[nI])
			if nCode = 34
				cOut += cB + cQ
			but nCode = 92
				cOut += cB + cB
			but nCode = 10
				cOut += "\n"
			but nCode = 13
				cOut += "\r"
			but nCode = 9
				cOut += "\t"
			but nCode = 8
				cOut += "\b"
			but nCode = 12
				cOut += "\f"
			else
				cOut += "\u00" + jsnHex2(nCode)
			ok
			nI += 1
		end
		nPos += nChunkLen
	end
	return cOut + cQ

func jsnHex2 n
	cHex = "0123456789abcdef"
	return substr(cHex, floor(n / 16) + 1, 1) + substr(cHex, (n % 16) + 1, 1)

func jsnEncObject v
	cOut = "{"
	for i = 1 to len(v)
		if i > 1
			cOut += ","
		ok
		cOut += jsnEncString(v[i][1]) + ":" + jsnEnc(v[i][2])
	next
	return cOut + "}"

func jsnEncArray v
	cOut = "["
	for i = 1 to len(v)
		if i > 1
			cOut += ","
		ok
		cOut += jsnEnc(v[i])
	next
	return cOut + "]"

# ---------------------------------------------------------------- decode

# The byte at text position n, or "" past the end. Refills the window only
# when n falls outside it: one substr per JSN_WINDOW bytes instead of one
# per byte. Every read below goes through here — none touches cJsnText.
func jsnAt n
	nOff = n - nJsnWinAt + 1
	if nOff >= 1 and nOff <= nJsnWinLen
		return cJsnWin[nOff]
	ok
	if n < 1 or n > len(cJsnText)
		return ""
	ok
	cJsnWin = substr(cJsnText, n, JSN_WINDOW)
	nJsnWinAt = n
	nJsnWinLen = len(cJsnWin)
	if nJsnWinLen = 0
		return ""
	ok
	return cJsnWin[1]

# Skips whitespace AND returns the byte now under nJsnPos ("" at the end).
# Returning it matters: every caller needs that byte, and a separate jsnAt()
# would be a second Ring function call per token. Those calls are the whole
# cost of decoding a small payload - going through jsnAt() everywhere made
# an 8.7 KB decode 46% slower even though it made 1 MB 267x faster.
func jsnSkipWs
	nSkipLen = len(cJsnText)
	while nJsnPos <= nSkipLen
		nOff = nJsnPos - nJsnWinAt + 1
		if nOff < 1 or nOff > nJsnWinLen
			nTake = nSkipLen - nJsnPos + 1
			if nTake > JSN_WINDOW
				nTake = JSN_WINDOW
			ok
			cJsnWin = substr(cJsnText, nJsnPos, nTake)
			nJsnWinAt = nJsnPos
			nJsnWinLen = len(cJsnWin)
			if nJsnWinLen = 0
				return ""
			ok
			nOff = 1
		ok
		cSkipCh = cJsnWin[nOff]
		nC = ascii(cSkipCh)
		if nC = 32 or nC = 9 or nC = 10 or nC = 13
			nJsnPos += 1
		else
			return cSkipCh
		ok
	end
	return ""

func jsnValue
	ch = jsnSkipWs()
	if ch = ""
		raise("json: unexpected end of input")
	ok
	if ch = "{"
		return jsnObject()
	but ch = "["
		return jsnArray()
	but ch = char(34)
		return jsnString()
	but ch = "t"
		jsnExpect("true")
		return 1
	but ch = "f"
		jsnExpect("false")
		return 0
	but ch = "n"
		jsnExpect("null")
		return NULL
	else
		return jsnNumber()
	ok

# Compared through the window, one byte at a time. The obvious
# substr(cJsnText, nJsnPos, len(cWord)) would be O(len(cJsnText)) per
# literal, so a payload of ten thousand `true`s would be quadratic again.
func jsnExpect cWord
	for i = 1 to len(cWord)
		if jsnAt(nJsnPos + i - 1) != cWord[i]
			raise("json: expected " + cWord + " at position " + nJsnPos)
		ok
	next
	nJsnPos += len(cWord)

func jsnObject
	aOut = []
	nJsnPos += 1
	if jsnSkipWs() = "}"
		nJsnPos += 1
		return aOut
	ok
	while true
		if jsnSkipWs() != char(34)
			raise("json: expected object key at position " + nJsnPos)
		ok
		cKey = jsnString()
		if jsnSkipWs() != ":"
			raise("json: expected colon at position " + nJsnPos)
		ok
		nJsnPos += 1
		vVal = jsnValue()
		add(aOut, [cKey, vVal])
		ch = jsnSkipWs()
		if ch = ","
			nJsnPos += 1
		but ch = "}"
			nJsnPos += 1
			exit
		else
			raise("json: expected , or } at position " + nJsnPos)
		ok
	end
	return aOut

func jsnArray
	aOut = []
	nJsnPos += 1
	if jsnSkipWs() = "]"
		nJsnPos += 1
		return aOut
	ok
	while true
		add(aOut, jsnValue())
		ch = jsnSkipWs()
		if ch = ","
			nJsnPos += 1
		but ch = "]"
			nJsnPos += 1
			exit
		else
			raise("json: expected , or ] at position " + nJsnPos)
		ok
	end
	return aOut

# The hot path of the whole decoder, and the one facing hostile input, so it
# works the window directly instead of calling jsnAt() per byte: a Ring
# function call per byte cost more than everything else combined (1,982 ms
# to decode 256 KB, against 222 ms to encode it). Ordinary bytes are copied
# a run at a time; only quotes and backslashes are handled singly.
func jsnString
	nJsnPos += 1
	cOut = ""
	nTextLen = len(cJsnText)
	while true
		if nJsnPos > nTextLen
			raise("json: unterminated string")
		ok
		nOff = nJsnPos - nJsnWinAt + 1
		if nOff < 1 or nOff > nJsnWinLen
			nTake = nTextLen - nJsnPos + 1
			if nTake > JSN_WINDOW
				nTake = JSN_WINDOW
			ok
			cJsnWin = substr(cJsnText, nJsnPos, nTake)
			nJsnWinAt = nJsnPos
			nJsnWinLen = len(cJsnWin)
			if nJsnWinLen = 0
				raise("json: unterminated string")
			ok
			nOff = 1
		ok
		nRun = nOff
		while nRun <= nJsnWinLen
			nCode = ascii(cJsnWin[nRun])
			if nCode = 34 or nCode = 92
				exit
			ok
			nRun += 1
		end
		if nRun > nOff
			cOut += substr(cJsnWin, nOff, nRun - nOff)
			nJsnPos += nRun - nOff
		ok
		if nRun > nJsnWinLen
			loop
		ok
		nCode = ascii(cJsnWin[nRun])
		if nCode = 34
			nJsnPos += 1
			exit
		but nCode = 92
			nJsnPos += 1
			cEsc = jsnAt(nJsnPos)
			if cEsc = char(34)
				cOut += char(34)
			but cEsc = "\"
				cOut += "\"
			but cEsc = "/"
				cOut += "/"
			but cEsc = "n"
				cOut += char(10)
			but cEsc = "r"
				cOut += char(13)
			but cEsc = "t"
				cOut += char(9)
			but cEsc = "b"
				cOut += char(8)
			but cEsc = "f"
				cOut += char(12)
			but cEsc = "u"
				cOut += jsnUnicode()
			else
				raise("json: bad escape at position " + nJsnPos)
			ok
			nJsnPos += 1
		ok
		# No else: the run loop above consumed every ordinary byte, so the
		# only ways here are a quote or a backslash.
	end
	return cOut

func jsnUnicode
	nCode = 0
	for i = 1 to 4
		nJsnPos += 1
		nCode = nCode * 16 + jsnHexVal(jsnAt(nJsnPos))
	next
	# UTF-8 encode (Ring strings are byte strings)
	if nCode < 128
		return char(nCode)
	but nCode < 2048
		return char(192 + floor(nCode / 64)) + char(128 + (nCode % 64))
	else
		return char(224 + floor(nCode / 4096)) +
		       char(128 + (floor(nCode / 64) % 64)) +
		       char(128 + (nCode % 64))
	ok

func jsnHexVal ch
	nPos = substr("0123456789abcdef", lower(ch))
	if nPos = 0
		raise("json: bad hex digit at position " + nJsnPos)
	ok
	return nPos - 1

func jsnNumber
	cNum = ""
	nNumLen = len(cJsnText)
	while nJsnPos <= nNumLen
		nOff = nJsnPos - nJsnWinAt + 1
		if nOff < 1 or nOff > nJsnWinLen
			nTake = nNumLen - nJsnPos + 1
			if nTake > JSN_WINDOW
				nTake = JSN_WINDOW
			ok
			cJsnWin = substr(cJsnText, nJsnPos, nTake)
			nJsnWinAt = nJsnPos
			nJsnWinLen = len(cJsnWin)
			if nJsnWinLen = 0
				exit
			ok
			nOff = 1
		ok
		ch = cJsnWin[nOff]
		if substr("-+.eE0123456789", ch) > 0
			cNum += ch
			nJsnPos += 1
		else
			exit
		ok
	end
	if len(cNum) = 0
		raise("json: bad value at position " + nJsnPos)
	ok
	return number(cNum)
