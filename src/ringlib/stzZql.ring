# runtime/ring/stzZql.ring
# -----------------------------------------------------------------------------
# stzZql -- the ZQL engine in Ring: StzWeb's OPTIONAL Ring runtime.
#
# StzWeb is self-sufficient on JS + web standards; Ring is one optional
# language for scripting business logic, and stzlib is an optional
# augmentation -- neither is a dependency of the framework or of this
# file. This module implements the same closed grammar (DEFINE ENTITY /
# NORM / FLOW -- destructive operations unparseable, not forbidden),
# the same expression evaluation, and the same kinetic flow semantics
# as the Zig CLI (cli/src/zql.zig) and the JS runtime
# (runtime/zql/zql-parser.js). One grammar, three runtimes.
#
# DELIBERATELY PURE CORE RING -- no stzlib, no stdlib -- so the exact
# same file can run under bare ring, under a future Ring-in-browser
# seam (RingScript or an stzBuild WASM target), or inside an stzlib
# session that chooses to adopt it. Whether ZQL ever belongs in the
# stzlib foundation is an stzlib decision, made there, not here.
#
# Surface:
#   o = StzZqlQ(cSource)              # parses or raises "stzZql (line N): ..."
#   o.CountEntities()/CountNorms()/CountFlows()
#   o.EntityRationale(cName) / o.NormMessage(cName) / o.FlowRationale(cName)
#   o.EvalNorm(cName, aData)          # aData = [ :field = value, ... ]
#   o.RunFlow(cName, aData)           # -> pair-list, see FLOW RESULT below
#   o.Describe()                      # the declaration surface as text
#
# FLOW RESULT keys: status ("complete"|"failed"), failedstep, actionverb,
# actionarg, committed (1|0), outcomes (list of [name, actor, ok, reason]).
# -----------------------------------------------------------------------------

func StzZqlQ(pcSource)
	return new stzZql(pcSource)

class stzZql

	@cSrc = ""
	@nPos = 1
	@nLine = 1

	@aTok = []          # current token: [type, value, line]

	@aEntities = []     # [name, fieldcount, rationale]
	@aNorms = []        # [name, message, ruleid]
	@aFlows = []        # [name, stepcount, rationale]
	@aStepInfo = []     # [flow, index, name, actor, validateid, onfailverb, onfailarg, commits]
	@aEnforcing = []    # [flow, stepname, norm]
	@aExprs = []
	@aZones = []        # [name, format, intoflow, rationale]        # node pool: ["and",l,r] | ["or",l,r] | ["cmp",op,lOperand,rOperand]

	def init(pcSource)
		@cSrc = pcSource
		@nPos = 1
		@nLine = 1
		This.Advance()
		while @aTok[1] != "eof"
			if @aTok[1] != "ident" or not (strcmp(@aTok[2], "DEFINE") = 0)
				This.Fail("Unknown verb '" + @aTok[2] + "'. The ZQL verb set is closed -- " +
					"destructive or unrecognized operations are not part of the grammar.")
			ok
			This.Advance()
			cWhat = This.Expect("ident")
			switch cWhat
			on "ENTITY"
				This.ParseEntity()
			on "NORM"
				This.ParseNorm()
			on "FLOW"
				This.ParseFlow()
			on "LANDING_ZONE"
				This.ParseZone()
			other
				This.Fail("Unknown declaration 'DEFINE " + cWhat + "'. The ZQL verb set is closed.")
			off
		end

	def Fail(cMsg)
		raise("stzZql (line " + @nLine + "): " + cMsg)

	# ------------------------------------------------------------ tokenizer

	def IsIdentStart(c)
		n = ascii(c)
		return (n >= 65 and n <= 90) or (n >= 97 and n <= 122) or c = "_"

	def IsIdentChar(c)
		n = ascii(c)
		return This.IsIdentStart(c) or (n >= 48 and n <= 57)

	def IsDigit(c)
		n = ascii(c)
		return n >= 48 and n <= 57

	def Peek(nOffset)
		if @nPos + nOffset <= len(@cSrc)
			return substr(@cSrc, @nPos + nOffset, 1)
		ok
		return ""

	def Advance()
		# skip whitespace and -- comments
		while @nPos <= len(@cSrc)
			c = substr(@cSrc, @nPos, 1)
			if c = nl
				@nLine = @nLine + 1
				@nPos = @nPos + 1
			but c = " " or c = char(9) or c = char(13)
				@nPos = @nPos + 1
			but c = "-" and This.Peek(1) = "-"
				while @nPos <= len(@cSrc) and substr(@cSrc, @nPos, 1) != nl
					@nPos = @nPos + 1
				end
			else
				exit
			ok
		end
		if @nPos > len(@cSrc)
			@aTok = ["eof", "", @nLine]
			return
		ok
		c = substr(@cSrc, @nPos, 1)
		if c = "-" and This.Peek(1) = ">"
			@nPos = @nPos + 2
			@aTok = ["arrow", "->", @nLine]
			return
		ok
		if c = "-"
			@nPos = @nPos + 1
			@aTok = ["minus", "-", @nLine]
			return
		ok
		if c = "(" or c = ")" or c = "{" or c = "}" or c = "," or c = ":" or c = "*" or c = "+" or c = "/"
			@nPos = @nPos + 1
			aMap = [ ["(", "lparen"], [")", "rparen"], ["{", "lbrace"], ["}", "rbrace"],
			         [",", "comma"], [":", "colon"], ["*", "star"], ["+", "plus"], ["/", "slash"] ]
			for i = 1 to len(aMap)
				if aMap[i][1] = c
					@aTok = [aMap[i][2], c, @nLine]
					return
				ok
			next
		ok
		if c = '"' or c = "'"
			cQuote = c
			nStart = @nPos + 1
			@nPos = @nPos + 1
			while @nPos <= len(@cSrc) and substr(@cSrc, @nPos, 1) != cQuote
				if substr(@cSrc, @nPos, 1) = nl
					This.Fail("Unterminated string")
				ok
				@nPos = @nPos + 1
			end
			if @nPos > len(@cSrc)
				This.Fail("Unterminated string")
			ok
			@aTok = ["string", substr(@cSrc, nStart, @nPos - nStart), @nLine]
			@nPos = @nPos + 1
			return
		ok
		cTwo = c + This.Peek(1)
		if cTwo = "!=" or cTwo = ">=" or cTwo = "<=" or cTwo = "=="
			@nPos = @nPos + 2
			@aTok = ["op", cTwo, @nLine]
			return
		ok
		if c = "=" or c = "<" or c = ">"
			@nPos = @nPos + 1
			@aTok = ["op", c, @nLine]
			return
		ok
		if This.IsDigit(c)
			nStart = @nPos
			while @nPos <= len(@cSrc)
				ch = substr(@cSrc, @nPos, 1)
				if This.IsDigit(ch) or ch = "."
					@nPos = @nPos + 1
				else
					exit
				ok
			end
			@aTok = ["number", substr(@cSrc, nStart, @nPos - nStart), @nLine]
			return
		ok
		if This.IsIdentStart(c)
			nStart = @nPos
			while @nPos <= len(@cSrc)
				ch = substr(@cSrc, @nPos, 1)
				if This.IsIdentChar(ch) or (ch = "." and This.IsIdentChar(substr(@cSrc, @nPos + 1, 1)))
					@nPos = @nPos + 1
				else
					exit
				ok
			end
			@aTok = ["ident", substr(@cSrc, nStart, @nPos - nStart), @nLine]
			return
		ok
		This.Fail("Unexpected character '" + c + "'")

	def Expect(cType)
		if @aTok[1] != cType
			This.Fail("Expected " + cType + " but found '" + @aTok[2] + "'")
		ok
		cValue = @aTok[2]
		This.Advance()
		return cValue

	def ExpectIdent(cValue)
		if @aTok[1] != "ident" or not (strcmp(@aTok[2], cValue) = 0)
			This.Fail("Expected '" + cValue + "' but found '" + @aTok[2] + "'")
		ok
		This.Advance()

	def AtIdent(cValue)
		return @aTok[1] = "ident" and strcmp(@aTok[2], cValue) = 0

	# ------------------------------------------------------------- parser

	def PushExpr(aNode)
		@aExprs + aNode
		return len(@aExprs)

	def ParseExpr()
		nLeft = This.ParseAnd()
		while This.AtIdent("OR")
			This.Advance()
			nRight = This.ParseAnd()
			nLeft = This.PushExpr(["or", nLeft, nRight])
		end
		return nLeft

	def ParseAnd()
		nLeft = This.ParsePrimary()
		while This.AtIdent("AND")
			This.Advance()
			nRight = This.ParsePrimary()
			nLeft = This.PushExpr(["and", nLeft, nRight])
		end
		return nLeft

	def ParsePrimary()
		if @aTok[1] = "lparen"
			This.Advance()
			nInner = This.ParseExpr()
			This.Expect("rparen")
			return nInner
		ok
		aLeft = This.ParseOperand()
		cOp = ""
		if @aTok[1] = "op"
			cOp = @aTok[2]
			This.Advance()
		but This.AtIdent("CONTAINS")
			cOp = "contains"
			This.Advance()
		else
			This.Fail("Expected a comparison operator after operand")
		ok
		aRight = This.ParseOperand()
		return This.PushExpr(["cmp", cOp, aLeft, aRight])

	def ParseOperand()
		switch @aTok[1]
		on "string"
			v = @aTok[2]
			This.Advance()
			return ["str", v]
		on "number"
			v = number(@aTok[2])
			This.Advance()
			return ["num", v]
		on "ident"
			if strcmp(@aTok[2], "true") = 0 or strcmp(@aTok[2], "false") = 0
				bVal = (strcmp(@aTok[2], "true") = 0)
				This.Advance()
				return ["bool", bVal]
			ok
			if strcmp(@aTok[2], "SUM") = 0 or strcmp(@aTok[2], "COUNT") = 0 or
			   strcmp(@aTok[2], "AVG") = 0 or strcmp(@aTok[2], "MIN") = 0 or
			   strcmp(@aTok[2], "MAX") = 0
				cFn = @aTok[2]
				This.Advance()
				This.Expect("lparen")
				cRefName = This.Expect("ident")
				This.Expect("rparen")
				return ["agg", cFn, cRefName]
			ok
			v = @aTok[2]
			This.Advance()
			return ["ref", v]
		other
			This.Fail("Expected a value or field reference, found '" + @aTok[2] + "'")
		off

	# aexpr := aterm { (+|-) aterm } ; aterm := afactor { (*|/) afactor }
	# afactor := ( aexpr ) | ROUND(aexpr) | number | ref | AGG(ref)
	def ParseAExpr()
		nLeft = This.ParseATerm()
		while @aTok[1] = "plus" or @aTok[1] = "minus"
			cOp = @aTok[1]
			This.Advance()
			nRight = This.ParseATerm()
			if cOp = "plus"
				nLeft = This.PushExpr(["add", nLeft, nRight])
			else
				nLeft = This.PushExpr(["sub", nLeft, nRight])
			ok
		end
		return nLeft

	def ParseATerm()
		nLeft = This.ParseAFactor()
		while @aTok[1] = "star" or @aTok[1] = "slash"
			cOp = @aTok[1]
			This.Advance()
			nRight = This.ParseAFactor()
			if cOp = "star"
				nLeft = This.PushExpr(["mul", nLeft, nRight])
			else
				nLeft = This.PushExpr(["div", nLeft, nRight])
			ok
		end
		return nLeft

	def ParseAFactor()
		if @aTok[1] = "lparen"
			This.Advance()
			nInner = This.ParseAExpr()
			This.Expect("rparen")
			return nInner
		ok
		if @aTok[1] = "ident" and strcmp(@aTok[2], "ROUND") = 0
			This.Advance()
			This.Expect("lparen")
			nInner = This.ParseAExpr()
			This.Expect("rparen")
			return This.PushExpr(["round", nInner])
		ok
		aOperand = This.ParseOperand()
		return This.PushExpr(["opnd", aOperand])

	def ParseRationale()
		if This.AtIdent("RATIONALE")
			This.Advance()
			return This.Expect("string")
		ok
		return ""

	def ParseEntity()
		cName = This.Expect("ident")
		This.Expect("lparen")
		nFields = 0
		while @aTok[1] != "rparen"
			This.Expect("ident")
			This.Expect("colon")
			This.Expect("ident")
			if @aTok[1] = "lparen"
				This.Advance()
				while @aTok[1] != "rparen"
					if @aTok[1] = "string" or @aTok[1] = "number" or @aTok[1] = "ident"
						This.Advance()
					else
						This.Fail("Invalid type argument '" + @aTok[2] + "'")
					ok
					if @aTok[1] = "comma"
						This.Advance()
					ok
				end
				This.Expect("rparen")
			ok
			nFields = nFields + 1
			if @aTok[1] = "comma"
				This.Advance()
			ok
		end
		This.Expect("rparen")
		cRationale = This.ParseRationale()
		@aEntities + [cName, nFields, cRationale]

	def ParseZone()
		cName = This.Expect("ident")
		This.ExpectIdent("AS")
		cFormat = This.Expect("ident")
		if cFormat != "JSON"
			This.Fail("Landing zone format '" + cFormat + "' is not in the grammar -- v0 accepts JSON only")
		ok
		if not This.AtIdent("INTO")
			This.Fail("A landing zone must declare INTO flow -- imports have no side door")
		ok
		This.Advance()
		cInto = This.Expect("ident")
		cRationale = This.ParseRationale()
		@aZones + [cName, cFormat, cInto, cRationale]

	def CountZones()
		return len(@aZones)

	def ParseNorm()
		cName = This.Expect("ident")
		This.ExpectIdent("AS")
		This.Expect("lparen")
		This.ExpectIdent("RULE")
		This.Expect("colon")
		nRule = This.ParseExpr()
		This.Expect("comma")
		This.ExpectIdent("MESSAGE")
		This.Expect("colon")
		cMessage = This.Expect("string")
		This.Expect("rparen")
		@aNorms + [cName, cMessage, nRule]

	def ParseFlow()
		cName = This.Expect("ident")
		This.Expect("lparen")
		nSteps = 0
		while @aTok[1] != "rparen"
			This.ExpectIdent("STEP")
			This.Expect("number")
			This.Expect("colon")
			cStepName = This.Expect("ident")
			This.Expect("arrow")
			This.Expect("lbrace")
			cActor = ""
			nValidate = 0
			nFormula = 0
			cFormulaTarget = ""
			cOnFailVerb = ""
			cOnFailArg = ""
			bCommits = 0
			while @aTok[1] != "rbrace"
				cKey = This.Expect("ident")
				This.Expect("colon")
				switch cKey
				on "ACTOR"
					cActor = This.Expect("ident")
				on "VALIDATE"
					nValidate = This.ParseExpr()
				on "FORMULA"
					cFormulaTarget = This.Expect("ident")
					cEq = This.Expect("op")
					if cEq != "="
						This.Fail("FORMULA expects ':field = expression'")
					ok
					nFormula = This.ParseAExpr()
				on "ENFORCING"
					cNorm = This.Expect("ident")
					@aEnforcing + [cName, cStepName, cNorm]
				on "ON_FAIL"
					cOnFailVerb = This.Expect("ident")
					if @aTok[1] = "string"
						cOnFailArg = @aTok[2]
						This.Advance()
					ok
				on "ON_SUCCESS"
					cVerb = This.Expect("ident")
					if @aTok[1] = "string"
						This.Advance()
					ok
					if cVerb = "COMMIT_TO_BEDROCK"
						bCommits = 1
					ok
				other
					This.Fail("Unknown step property '" + cKey +
						"' -- allowed: ACTOR, VALIDATE, ENFORCING, ON_FAIL, ON_SUCCESS")
				off
				if @aTok[1] = "comma"
					This.Advance()
				ok
			end
			This.Expect("rbrace")
			@aStepInfo + [cName, nSteps, cStepName, cActor, nValidate, cOnFailVerb, cOnFailArg, bCommits, nFormula, cFormulaTarget]
			nSteps = nSteps + 1
			if @aTok[1] = "comma"
				This.Advance()
			ok
		end
		This.Expect("rparen")
		cRationale = This.ParseRationale()
		@aFlows + [cName, nSteps, cRationale]

	# ------------------------------------------------------------ surface

	def CountEntities()
		return len(@aEntities)

	def CountNorms()
		return len(@aNorms)

	def CountFlows()
		return len(@aFlows)

	def EntityRationale(cName)
		for i = 1 to len(@aEntities)
			if @aEntities[i][1] = cName
				return @aEntities[i][3]
			ok
		next
		return ""

	def NormMessage(cName)
		for i = 1 to len(@aNorms)
			if @aNorms[i][1] = cName
				return @aNorms[i][2]
			ok
		next
		return ""

	def FlowRationale(cName)
		for i = 1 to len(@aFlows)
			if @aFlows[i][1] = cName
				return @aFlows[i][3]
			ok
		next
		return ""

	def Describe()
		cOut = ""
		for i = 1 to len(@aEntities)
			cOut = cOut + "entity " + @aEntities[i][1] + " (" + @aEntities[i][2] +
				" fields) -- " + @aEntities[i][3] + nl
		next
		for i = 1 to len(@aNorms)
			cOut = cOut + "norm " + @aNorms[i][1] + ' -- "' + @aNorms[i][2] + '"' + nl
		next
		for i = 1 to len(@aFlows)
			cOut = cOut + "flow " + @aFlows[i][1] + " (" + @aFlows[i][2] +
				" steps) -- " + @aFlows[i][3] + nl
		next
		for i = 1 to len(@aZones)
			cOut = cOut + "zone " + @aZones[i][1] + " (" + @aZones[i][2] +
				" into " + @aZones[i][3] + ") -- " + @aZones[i][4] + nl
		next
		for i = 1 to len(@aEnforcing)
			cOut = cOut + "link: flow " + @aEnforcing[i][1] + " step " + @aEnforcing[i][2] +
				" ENFORCING norm " + @aEnforcing[i][3] + nl
		next
		return cOut

	# --------------------------------------------------------------- eval

	def PathParts(cPath)
		# core-Ring split on '.' (stdlib's split() is not assumed --
		# this module must run in bare ring and ringscript.wasm)
		aParts = []
		cPart = ""
		for i = 1 to len(cPath)
			c = substr(cPath, i, 1)
			if c = "."
				aParts + cPart
				cPart = ""
			else
				cPart = cPart + c
			ok
		next
		aParts + cPart
		return aParts

	def DataValue(aData, cPath)
		# dotted path over pair-lists; returns [kind, value], kind in
		# "num" | "str" | "bool" | "missing"
		aCurrent = aData
		aParts = This.PathParts(cPath)
		for p = 1 to len(aParts)
			if not isList(aCurrent)
				return ["missing", ""]
			ok
			bFound = 0
			for i = 1 to len(aCurrent)
				if isList(aCurrent[i]) and len(aCurrent[i]) = 2 and
				   isString(aCurrent[i][1]) and lower(aCurrent[i][1]) = lower(aParts[p])
					vNext = aCurrent[i][2]
					bFound = 1
					exit
				ok
			next
			if not bFound
				return ["missing", ""]
			ok
			aCurrent = vNext
		next
		if isNumber(aCurrent)
			return ["num", aCurrent]
		but isString(aCurrent)
			return ["str", aCurrent]
		ok
		return ["missing", ""]

	def ResolveOperand(aOperand, aData)
		switch aOperand[1]
		on "num"
			return ["num", aOperand[2]]
		on "str"
			return ["str", aOperand[2]]
		on "bool"
			if aOperand[2]
				return ["num", 1]
			ok
			return ["num", 0]
		on "ref"
			return This.DataValue(aData, aOperand[2])
		on "agg"
			return ["num", This.AggValue(aOperand[2], aOperand[3], aData)]
		off
		return ["missing", ""]

	def AsNumber(aResolved)
		# returns [ok, value]. NOTE: Ring's number() RAISES on a
		# non-numeric string, so the character check must come first.
		if aResolved[1] = "num"
			return [1, aResolved[2]]
		ok
		if aResolved[1] = "str" and aResolved[2] != ""
			cT = aResolved[2]
			bNumeric = 1
			for i = 1 to len(cT)
				c = substr(cT, i, 1)
				if not (This.IsDigit(c) or c = "." or c = "-")
					bNumeric = 0
					exit
				ok
			next
			if bNumeric
				return [1, number(cT)]
			ok
		ok
		return [0, 0]

	def AsText(aResolved)
		if aResolved[1] = "str"
			return aResolved[2]
		but aResolved[1] = "num"
			return "" + aResolved[2]
		ok
		return ""

	def CompareResolved(cOp, aLeft, aRight)
		if cOp = "contains"
			return substr(lower(This.AsText(aLeft)), lower(This.AsText(aRight))) > 0
		ok
		aLn = This.AsNumber(aLeft)
		aRn = This.AsNumber(aRight)
		if aLn[1] and aRn[1]
			nLeftNum = aLn[2]
			nRightNum = aRn[2]
			switch cOp
			on "="
				return nLeftNum = nRightNum
			on "=="
				return nLeftNum = nRightNum
			on "!="
				return nLeftNum != nRightNum
			on ">"
				return nLeftNum > nRightNum
			on ">="
				return nLeftNum >= nRightNum
			on "<"
				return nLeftNum < nRightNum
			on "<="
				return nLeftNum <= nRightNum
			off
			return 0
		ok
		cL = This.AsText(aLeft)
		cR = This.AsText(aRight)
		switch cOp
		on "="
			return cL = cR
		on "=="
			return cL = cR
		on "!="
			return cL != cR
		on ">"
			return strcmp(cL, cR) > 0
		on ">="
			return strcmp(cL, cR) >= 0
		on "<"
			return strcmp(cL, cR) < 0
		on "<="
			return strcmp(cL, cR) <= 0
		off
		return 0

	def AggValue(cFn, cRefName, aData)
		aRes = This.DataListValue(aData, cRefName)
		nSum = 0
		nCount = 0
		nMin = 0
		nMax = 0
		for i = 1 to len(aRes)
			v = aRes[i]
			if isNumber(v)
				if nCount = 0
					nMin = v
					nMax = v
				else
					if v < nMin
						nMin = v
					ok
					if v > nMax
						nMax = v
					ok
				ok
				nSum = nSum + v
				nCount = nCount + 1
			ok
		next
		switch cFn
		on "SUM"
			return nSum
		on "COUNT"
			return nCount
		on "AVG"
			if nCount = 0
				return 0
			ok
			return nSum / nCount
		on "MIN"
			return nMin
		on "MAX"
			return nMax
		off
		return 0

	def DataListValue(aData, cPath)
		# like DataValue but for list-valued fields; [] when missing
		aCurrent = aData
		aParts = This.PathParts(cPath)
		for pp = 1 to len(aParts)
			if not isList(aCurrent)
				return []
			ok
			bFound = 0
			for i = 1 to len(aCurrent)
				if isList(aCurrent[i]) and len(aCurrent[i]) = 2 and
				   isString(aCurrent[i][1]) and lower(aCurrent[i][1]) = lower(aParts[pp])
					vNext = aCurrent[i][2]
					bFound = 1
					exit
				ok
			next
			if not bFound
				return []
			ok
			aCurrent = vNext
		next
		if isList(aCurrent)
			return aCurrent
		ok
		return []

	def RoundHalf(x)
		if x >= 0
			return floor(x + 0.5)
		ok
		return 0 - floor((0 - x) + 0.5)

	def EvalNum(nId, aData)
		aNode = @aExprs[nId]
		switch aNode[1]
		on "add"
			return This.EvalNum(aNode[2], aData) + This.EvalNum(aNode[3], aData)
		on "sub"
			return This.EvalNum(aNode[2], aData) - This.EvalNum(aNode[3], aData)
		on "mul"
			return This.EvalNum(aNode[2], aData) * This.EvalNum(aNode[3], aData)
		on "div"
			nDen = This.EvalNum(aNode[3], aData)
			if nDen = 0
				return 0
			ok
			return This.EvalNum(aNode[2], aData) / nDen
		on "round"
			return This.RoundHalf(This.EvalNum(aNode[2], aData))
		on "opnd"
			aRes = This.ResolveOperand(aNode[2], aData)
			aNum = This.AsNumber(aRes)
			if aNum[1]
				return aNum[2]
			ok
			return 0
		off
		return 0

	def EvalExpr(nId, aData)
		aNode = @aExprs[nId]
		switch aNode[1]
		on "and"
			return This.EvalExpr(aNode[2], aData) and This.EvalExpr(aNode[3], aData)
		on "or"
			return This.EvalExpr(aNode[2], aData) or This.EvalExpr(aNode[3], aData)
		on "cmp"
			return This.CompareResolved(aNode[2],
				This.ResolveOperand(aNode[3], aData),
				This.ResolveOperand(aNode[4], aData))
		off
		return 0

	def EvalNorm(cName, aData)
		for i = 1 to len(@aNorms)
			if @aNorms[i][1] = cName
				return This.EvalExpr(@aNorms[i][3], aData)
			ok
		next
		raise("stzZql: no norm named " + cName)

	# --------------------------------------------------------- flow runner

	def RunFlow(cFlowName, aData)
		bFound = 0
		for i = 1 to len(@aFlows)
			if @aFlows[i][1] = cFlowName
				bFound = 1
			ok
		next
		if not bFound
			raise("stzZql: no flow named " + cFlowName)
		ok
		aOutcomes = []
		aComputed = []
		bCommitted = 0
		aWork = aData
		for i = 1 to len(@aStepInfo)
			aStep = @aStepInfo[i]
			if aStep[1] != cFlowName
				loop
			ok
			if len(aStep) >= 9 and aStep[9] > 0
				nFVal = This.EvalNum(aStep[9], aWork)
				aWork = This.WithComputed(aWork, aStep[10], nFVal)
				aComputed + [aStep[10], nFVal]
			ok
			bOk = 1
			cReason = ""
			if aStep[5] > 0 and not This.EvalExpr(aStep[5], aWork)
				bOk = 0
				cReason = "VALIDATE failed"
			ok
			if bOk
				for e = 1 to len(@aEnforcing)
					if @aEnforcing[e][1] = cFlowName and @aEnforcing[e][2] = aStep[3]
						if not This.EvalNorm(@aEnforcing[e][3], aWork)
							bOk = 0
							cReason = This.NormMessage(@aEnforcing[e][3])
							exit
						ok
					ok
				next
			ok
			aOutcomes + [aStep[3], aStep[4], bOk, cReason]
			if not bOk
				cVerb = aStep[6]
				if cVerb = ""
					cVerb = "REJECT"
				ok
				return [ :status = "failed", :failedstep = aStep[3],
					:actionverb = cVerb, :actionarg = aStep[7],
					:committed = 0, :outcomes = aOutcomes, :computed = aComputed ]
			ok
			if aStep[8]
				bCommitted = 1
			ok
		next
		return [ :status = "complete", :failedstep = "", :actionverb = "",
			:actionarg = "", :committed = bCommitted, :outcomes = aOutcomes, :computed = aComputed ]

	def WithComputed(aData, cKey, nVal)
		# computed values shadow the payload: prepend, since lookups
		# return the FIRST match
		aNew = [ [cKey, nVal] ]
		for i = 1 to len(aData)
			aNew + aData[i]
		next
		return aNew
