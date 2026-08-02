# ringlib/json.ring — pure-Ring JSON encode/decode for the RingScript bridge.
#
# Convention (REPAIR_PLAN.md §3): JSON object <-> Ring pair-list [ :key = v ],
# JSON array <-> plain list, string <-> string, number <-> number,
# true/false -> 1/0, null -> NULL.
#
# Note: Ring string literals have NO escape sequences, so "\n" below is a
# literal backslash followed by n — exactly the two characters JSON needs.

cJsnText = ""
nJsnPos = 0

func JsonEncode v
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

func JsonDecode cJson
	cJsnText = cJson
	nJsnPos = 1
	return jsnValue()

# ---------------------------------------------------------------- encode

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

func jsnEncNumber n
	if n = floor(n)
		return string(floor(n))
	ok
	decimals(14)
	cS = string(n)
	decimals(2)
	while len(cS) > 1 and right(cS, 1) = "0"
		cS = left(cS, len(cS) - 1)
	end
	if right(cS, 1) = "."
		cS = left(cS, len(cS) - 1)
	ok
	return cS

func jsnEncString c
	cQ = char(34)
	cB = "\"
	cOut = cQ
	for i = 1 to len(c)
		ch = substr(c, i, 1)
		nCode = ascii(ch)
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
		but nCode < 32
			cOut += "\u00" + jsnHex2(nCode)
		else
			cOut += ch
		ok
	next
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
		cOut += jsnEncString(v[i][1]) + ":" + JsonEncode(v[i][2])
	next
	return cOut + "}"

func jsnEncArray v
	cOut = "["
	for i = 1 to len(v)
		if i > 1
			cOut += ","
		ok
		cOut += JsonEncode(v[i])
	next
	return cOut + "]"

# ---------------------------------------------------------------- decode

func jsnSkipWs
	while nJsnPos <= len(cJsnText)
		nC = ascii(substr(cJsnText, nJsnPos, 1))
		if nC = 32 or nC = 9 or nC = 10 or nC = 13
			nJsnPos += 1
		else
			exit
		ok
	end

func jsnValue
	jsnSkipWs()
	if nJsnPos > len(cJsnText)
		raise("json: unexpected end of input")
	ok
	ch = substr(cJsnText, nJsnPos, 1)
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

func jsnExpect cWord
	if substr(cJsnText, nJsnPos, len(cWord)) != cWord
		raise("json: expected " + cWord + " at position " + nJsnPos)
	ok
	nJsnPos += len(cWord)

func jsnObject
	aOut = []
	nJsnPos += 1
	jsnSkipWs()
	if nJsnPos <= len(cJsnText) and substr(cJsnText, nJsnPos, 1) = "}"
		nJsnPos += 1
		return aOut
	ok
	while true
		jsnSkipWs()
		if substr(cJsnText, nJsnPos, 1) != char(34)
			raise("json: expected object key at position " + nJsnPos)
		ok
		cKey = jsnString()
		jsnSkipWs()
		if substr(cJsnText, nJsnPos, 1) != ":"
			raise("json: expected colon at position " + nJsnPos)
		ok
		nJsnPos += 1
		vVal = jsnValue()
		add(aOut, [cKey, vVal])
		jsnSkipWs()
		ch = substr(cJsnText, nJsnPos, 1)
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
	jsnSkipWs()
	if nJsnPos <= len(cJsnText) and substr(cJsnText, nJsnPos, 1) = "]"
		nJsnPos += 1
		return aOut
	ok
	while true
		add(aOut, jsnValue())
		jsnSkipWs()
		ch = substr(cJsnText, nJsnPos, 1)
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

func jsnString
	nJsnPos += 1
	cOut = ""
	while true
		if nJsnPos > len(cJsnText)
			raise("json: unterminated string")
		ok
		ch = substr(cJsnText, nJsnPos, 1)
		nCode = ascii(ch)
		if nCode = 34
			nJsnPos += 1
			exit
		but nCode = 92
			nJsnPos += 1
			cEsc = substr(cJsnText, nJsnPos, 1)
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
		else
			cOut += ch
			nJsnPos += 1
		ok
	end
	return cOut

func jsnUnicode
	nCode = 0
	for i = 1 to 4
		nJsnPos += 1
		nCode = nCode * 16 + jsnHexVal(substr(cJsnText, nJsnPos, 1))
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
	while nJsnPos <= len(cJsnText)
		ch = substr(cJsnText, nJsnPos, 1)
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
