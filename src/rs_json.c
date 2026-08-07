/*
** RingScript — JSON codec in C (docs/HEADROOM_PLAN.md P2).
**
** The pure-Ring codec (ringlib/json.ring) walks bytes in interpreted code,
** and rivals.md measured the cost: 28x slower than Lua's pure codec on the
** same payload, ~1 s for a megabyte. The reason is structural — Ring copies
** every string argument onto the VM stack (PUSHCVAR), so no Ring-level
** codec can touch a big string cheaply. C reads the argument once.
**
** THE CONTRACT IS BYTE-EXACTNESS with ringlib/json.ring, which remains the
** reference implementation and the one native Ring runs. Same output bytes,
** same raise() messages with the same 1-based positions, same number
** formatting (through ring_general_numtostring, the VM's own), same
** tolerance quirks (a lone "+" is number 0; text after the first value is
** ignored). Number edge cases are DELEGATED: any token that Ring's number()
** would reject, or that strtod flags, is handed back to the wrapper
** (ringlib/json_wasm.ring), which calls the real number() — so those errors
** are identical by construction, not by imitation.
**
** Errors never raise from here. rs_jsondecode returns
**   [1, value]   parsed
**   [0, msg]     the wrapper raise()s msg — exactly what json.ring raises
**   [2, token]   the wrapper returns number(token), reproducing number()'s
**                own behavior on that token
*/
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <errno.h>
#include <math.h>
#include "ring.h"

extern unsigned int rs_vm_decimals(void *pPointer);

/* ------------------------------------------------------ growable buffer */

typedef struct RsJBuf {
	char *pData;
	size_t nLen;
	size_t nCap;
	int lOom;
} RsJBuf;

static int rs_jbuf_want(RsJBuf *pBuf, size_t nMore) {
	size_t nCap;
	char *pNew;
	if (pBuf->lOom) {
		return 0;
	}
	if (pBuf->nLen + nMore <= pBuf->nCap) {
		return 1;
	}
	nCap = pBuf->nCap ? pBuf->nCap : 256;
	while (nCap < pBuf->nLen + nMore) {
		nCap *= 2;
	}
	pNew = (char *)realloc(pBuf->pData, nCap);
	if (pNew == NULL) {
		pBuf->lOom = 1;
		return 0;
	}
	pBuf->pData = pNew;
	pBuf->nCap = nCap;
	return 1;
}

static void rs_jbuf_put(RsJBuf *pBuf, const char *cStr, size_t nSize) {
	if (rs_jbuf_want(pBuf, nSize)) {
		memcpy(pBuf->pData + pBuf->nLen, cStr, nSize);
		pBuf->nLen += nSize;
	}
}

static void rs_jbuf_putc(RsJBuf *pBuf, char c) {
	if (rs_jbuf_want(pBuf, 1)) {
		pBuf->pData[pBuf->nLen++] = c;
	}
}

/* --------------------------------------------------------------- encode */

/* jsnIsPairList, verbatim semantics. */
static int rs_je_ispairlist(List *pList) {
	unsigned int i, nSize;
	List *pItem;
	nSize = ring_list_getsize(pList);
	if (nSize == 0) {
		return 0;
	}
	for (i = 1; i <= nSize; i++) {
		if (!ring_list_islist(pList, i)) {
			return 0;
		}
		pItem = ring_list_getlist(pList, i);
		if (ring_list_getsize(pItem) != 2 || !ring_list_isstring(pItem, 1)) {
			return 0;
		}
	}
	return 1;
}

/*
** jsnEncNumber. The integer branch is string(floor(n)) under whatever
** decimals() is in force AT THAT MOMENT — the pure codec raises precision
** to 14 lazily, on the first fraction — so the same statefulness lives in
** *pnDec (starts at the user's setting, becomes 14 on the first fraction).
** For in-range integers numtostring ignores decimals entirely (it prints
** through %lld), but an integral value too large for long long falls into
** the %.{d}f-then-%.90e path where the setting can matter, and byte-exact
** means byte-exact.
*/
static void rs_je_number(RsJBuf *pBuf, double n, int *pnDec) {
	char cNum[192]; /* RING_MEDIUMBUF is 128; numtostring never exceeds it */
	size_t nLen;
	if (n == floor(n)) {
		ring_general_numtostring(floor(n), cNum, *pnDec);
		rs_jbuf_put(pBuf, cNum, strlen(cNum));
		return;
	}
	*pnDec = 14;
	ring_general_numtostring(n, cNum, 14);
	nLen = strlen(cNum);
	while (nLen > 1 && cNum[nLen - 1] == '0') {
		nLen--;
	}
	if (nLen > 1 && cNum[nLen - 1] == '.') {
		nLen--;
	}
	rs_jbuf_put(pBuf, cNum, nLen);
}

/* jsnEncString: same escapes, same lowercase \u00xx for other control
** bytes, bytes >= 32 pass through untouched (UTF-8 transparency). Runs are
** copied whole between escapes. */
static void rs_je_string(RsJBuf *pBuf, const char *cStr, size_t nSize) {
	static const char cHex[] = "0123456789abcdef";
	size_t i, nRun;
	unsigned char c;
	rs_jbuf_putc(pBuf, '"');
	i = 0;
	while (i < nSize) {
		nRun = i;
		while (nRun < nSize) {
			c = (unsigned char)cStr[nRun];
			if (c < 32 || c == '"' || c == '\\') {
				break;
			}
			nRun++;
		}
		if (nRun > i) {
			rs_jbuf_put(pBuf, cStr + i, nRun - i);
			i = nRun;
		}
		if (i >= nSize) {
			break;
		}
		c = (unsigned char)cStr[i];
		switch (c) {
		case '"':
			rs_jbuf_put(pBuf, "\\\"", 2);
			break;
		case '\\':
			rs_jbuf_put(pBuf, "\\\\", 2);
			break;
		case '\n':
			rs_jbuf_put(pBuf, "\\n", 2);
			break;
		case '\r':
			rs_jbuf_put(pBuf, "\\r", 2);
			break;
		case '\t':
			rs_jbuf_put(pBuf, "\\t", 2);
			break;
		case '\b':
			rs_jbuf_put(pBuf, "\\b", 2);
			break;
		case '\f':
			rs_jbuf_put(pBuf, "\\f", 2);
			break;
		default:
			rs_jbuf_put(pBuf, "\\u00", 4);
			rs_jbuf_putc(pBuf, cHex[c / 16]);
			rs_jbuf_putc(pBuf, cHex[c % 16]);
			break;
		}
		i++;
	}
	rs_jbuf_putc(pBuf, '"');
}

static void rs_je_list(RsJBuf *pBuf, List *pList, int *pnDec);

/* jsnEnc: number / string / list(object|array) / anything else -> null. */
static void rs_je_listitem(RsJBuf *pBuf, List *pList, unsigned int i, int *pnDec) {
	if (ring_list_isnumber(pList, i)) {
		rs_je_number(pBuf, ring_list_getdouble(pList, i), pnDec);
	} else if (ring_list_isstring(pList, i)) {
		rs_je_string(pBuf, ring_list_getstring(pList, i), ring_list_getstringsize(pList, i));
	} else if (ring_list_islist(pList, i)) {
		rs_je_list(pBuf, ring_list_getlist(pList, i), pnDec);
	} else {
		rs_jbuf_put(pBuf, "null", 4);
	}
}

static void rs_je_list(RsJBuf *pBuf, List *pList, int *pnDec) {
	unsigned int i, nSize;
	List *pPair;
	nSize = ring_list_getsize(pList);
	if (rs_je_ispairlist(pList)) {
		rs_jbuf_putc(pBuf, '{');
		for (i = 1; i <= nSize; i++) {
			if (i > 1) {
				rs_jbuf_putc(pBuf, ',');
			}
			pPair = ring_list_getlist(pList, i);
			rs_je_string(pBuf, ring_list_getstring(pPair, 1), ring_list_getstringsize(pPair, 1));
			rs_jbuf_putc(pBuf, ':');
			rs_je_listitem(pBuf, pPair, 2, pnDec);
		}
		rs_jbuf_putc(pBuf, '}');
	} else {
		rs_jbuf_putc(pBuf, '[');
		for (i = 1; i <= nSize; i++) {
			if (i > 1) {
				rs_jbuf_putc(pBuf, ',');
			}
			rs_je_listitem(pBuf, pList, i, pnDec);
		}
		rs_jbuf_putc(pBuf, ']');
	}
}

void rs_jsonencode_hook(void *pPointer) {
	RsJBuf buf = {NULL, 0, 0, 0};
	int nDec;
	if (RING_API_PARACOUNT != 1) {
		RING_API_ERROR(RING_API_MISS1PARA);
		return;
	}
	nDec = (int)rs_vm_decimals(pPointer);
	if (RING_API_ISNUMBER(1)) {
		rs_je_number(&buf, RING_API_GETNUMBER(1), &nDec);
	} else if (RING_API_ISSTRING(1)) {
		rs_je_string(&buf, RING_API_GETSTRING(1), RING_API_GETSTRINGSIZE(1));
	} else if (RING_API_ISLIST(1)) {
		rs_je_list(&buf, RING_API_GETLIST(1), &nDec);
	} else {
		rs_jbuf_put(&buf, "null", 4);
	}
	if (buf.lOom) {
		free(buf.pData);
		RING_API_ERROR("rs_jsonencode: out of memory");
		return;
	}
	RING_API_RETSTRING2(buf.pData ? buf.pData : "", buf.nLen);
	free(buf.pData);
}

/* --------------------------------------------------------------- decode */

typedef struct RsJDec {
	void *pPointer;  /* the VM, for the RING_API macros                */
	void *pState;    /* RingState, for the _gc allocators              */
	const char *cText;
	size_t nSize;
	size_t nPos;     /* 0-based here; reported 1-based, like nJsnPos   */
	int nDepth;      /* container nesting, capped — see rs_jd_value    */
	int nStatus;     /* 1 ok, 0 raise message, 2 delegate to number()  */
	char cErr[96];   /* the exact raise() text                         */
	size_t nTokAt;   /* the delegated number token, by reference into  */
	size_t nTokLen;  /* cText — never truncated, however long          */
	RsJBuf sScratch; /* string unescape buffer, reused                 */
} RsJDec;

static void rs_jd_fail(RsJDec *pD, const char *cWhat, long nPos1Based) {
	if (pD->nStatus != 1) {
		return;
	}
	pD->nStatus = 0;
	if (nPos1Based >= 0) {
		snprintf(pD->cErr, sizeof(pD->cErr), "json: %s at position %ld", cWhat, nPos1Based);
	} else {
		snprintf(pD->cErr, sizeof(pD->cErr), "json: %s", cWhat);
	}
}

/* jsnSkipWs: the same four whitespace bytes. Returns the byte under nPos,
** or 0 at end of input, with nPos left on the byte (or one past the end). */
static int rs_jd_skipws(RsJDec *pD) {
	unsigned char c;
	while (pD->nPos < pD->nSize) {
		c = (unsigned char)pD->cText[pD->nPos];
		if (c == 32 || c == 9 || c == 10 || c == 13) {
			pD->nPos++;
		} else {
			return c;
		}
	}
	return 0;
}

static int rs_jd_value(RsJDec *pD, List *pParent);

/* jsnExpect: a mismatch anywhere raises with the literal's START position. */
static int rs_jd_expect(RsJDec *pD, const char *cWord) {
	size_t i, nLen = strlen(cWord);
	for (i = 0; i < nLen; i++) {
		if (pD->nPos + i >= pD->nSize || pD->cText[pD->nPos + i] != cWord[i]) {
			char cMsg[32];
			snprintf(cMsg, sizeof(cMsg), "expected %s", cWord);
			rs_jd_fail(pD, cMsg, (long)(pD->nPos + 1));
			return 0;
		}
	}
	pD->nPos += nLen;
	return 1;
}

/* jsnString + jsnUnicode. Ordinary runs are copied whole; \uXXXX becomes
** 1-3 UTF-8 bytes with NO surrogate pairing — exactly what jsnUnicode
** does, quirk included. Appends the unescaped string to pParent. */
static int rs_jd_string(RsJDec *pD, List *pParent) {
	RsJBuf *pS = &pD->sScratch;
	size_t nRun;
	unsigned char c;
	pS->nLen = 0;
	pD->nPos++; /* past the opening quote */
	for (;;) {
		if (pD->nPos >= pD->nSize) {
			rs_jd_fail(pD, "unterminated string", -1);
			return 0;
		}
		nRun = pD->nPos;
		while (nRun < pD->nSize) {
			c = (unsigned char)pD->cText[nRun];
			if (c == '"' || c == '\\') {
				break;
			}
			nRun++;
		}
		if (nRun > pD->nPos) {
			rs_jbuf_put(pS, pD->cText + pD->nPos, nRun - pD->nPos);
			pD->nPos = nRun;
		}
		if (pD->nPos >= pD->nSize) {
			rs_jd_fail(pD, "unterminated string", -1);
			return 0;
		}
		c = (unsigned char)pD->cText[pD->nPos];
		if (c == '"') {
			pD->nPos++;
			break;
		}
		/* backslash: nJsnPos moves to the escape char, which is the
		** position every escape error reports */
		pD->nPos++;
		c = pD->nPos < pD->nSize ? (unsigned char)pD->cText[pD->nPos] : 0;
		switch (c) {
		case '"':
			rs_jbuf_putc(pS, '"');
			break;
		case '\\':
			rs_jbuf_putc(pS, '\\');
			break;
		case '/':
			rs_jbuf_putc(pS, '/');
			break;
		case 'n':
			rs_jbuf_putc(pS, 10);
			break;
		case 'r':
			rs_jbuf_putc(pS, 13);
			break;
		case 't':
			rs_jbuf_putc(pS, 9);
			break;
		case 'b':
			rs_jbuf_putc(pS, 8);
			break;
		case 'f':
			rs_jbuf_putc(pS, 12);
			break;
		case 'u': {
			unsigned int nCode = 0, k;
			for (k = 0; k < 4; k++) {
				int nDigit;
				pD->nPos++; /* jsnUnicode: advance, THEN read */
				if (pD->nPos < pD->nSize) {
					unsigned char h = (unsigned char)pD->cText[pD->nPos];
					if (h >= '0' && h <= '9') {
						nDigit = h - '0';
					} else if (h >= 'a' && h <= 'f') {
						nDigit = 10 + h - 'a';
					} else if (h >= 'A' && h <= 'F') {
						nDigit = 10 + h - 'A';
					} else {
						nDigit = -1;
					}
				} else {
					nDigit = -1;
				}
				if (nDigit < 0) {
					rs_jd_fail(pD, "bad hex digit", (long)(pD->nPos + 1));
					return 0;
				}
				nCode = nCode * 16 + (unsigned int)nDigit;
			}
			if (nCode < 128) {
				rs_jbuf_putc(pS, (char)nCode);
			} else if (nCode < 2048) {
				rs_jbuf_putc(pS, (char)(192 + nCode / 64));
				rs_jbuf_putc(pS, (char)(128 + nCode % 64));
			} else {
				rs_jbuf_putc(pS, (char)(224 + nCode / 4096));
				rs_jbuf_putc(pS, (char)(128 + (nCode / 64) % 64));
				rs_jbuf_putc(pS, (char)(128 + nCode % 64));
			}
			break;
		}
		default:
			rs_jd_fail(pD, "bad escape", (long)(pD->nPos + 1));
			return 0;
		}
		pD->nPos++;
	}
	if (pS->lOom) {
		rs_jd_fail(pD, "out of memory", -1);
		return 0;
	}
	ring_list_addstring2_gc(pD->pState, pParent, pS->pData ? pS->pData : "", (unsigned int)pS->nLen);
	return 1;
}

/*
** jsnNumber, with number()'s own validation replicated from genlib_e.c —
** and every path that validation or strtod would complain about DELEGATED
** (status 2): the wrapper calls the real number() on the token, so those
** errors stay Ring's own rather than an imitation of them.
*/
static int rs_jd_number(RsJDec *pD, List *pParent) {
	size_t nStart = pD->nPos, nLen, y;
	int lValue = 0, lSign = 0, lDot = 0, lExp = 0, lDelegate = 0;
	const char *cTok;
	while (pD->nPos < pD->nSize && pD->cText[pD->nPos] != 0 &&
	       strchr("-+.eE0123456789", pD->cText[pD->nPos]) != NULL) {
		pD->nPos++;
	}
	nLen = pD->nPos - nStart;
	if (nLen == 0) {
		rs_jd_fail(pD, "bad value", (long)(nStart + 1));
		return 0;
	}
	if (nLen >= 160) {
		lDelegate = 1; /* longer than the strtod scratch: let number() judge */
	}
	cTok = pD->cText + nStart;
	/* number()'s scanner, restricted to this charset (no hex, no spaces,
	** no digit groups can appear inside a JSON number token) */
	for (y = 0; y < nLen && !lDelegate; y++) {
		char ch = cTok[y];
		if (ch >= '0' && ch <= '9') {
			lValue = 1;
		} else if ((!lDot) && ch == '.') {
			lDot = 1;
		} else if ((y == 0) && (!lSign) && (ch == '-' || ch == '+')) {
			lSign = 1;
		} else if ((!lExp) && (y > 0) && (y < nLen - 1) && (ch == 'e' || ch == 'E') &&
			   (cTok[y + 1] == '+' || cTok[y + 1] == '-' ||
			    (cTok[y + 1] >= '0' && cTok[y + 1] <= '9'))) {
			lExp = 1;
			y++;
		} else {
			lDelegate = 1; /* number() would raise NUMERICINVALID */
		}
	}
	if (!lDelegate && lValue == 0) {
		/* "If no digits then return zero" — number("+") is 0 */
		ring_list_adddouble_gc(pD->pState, pParent, 0.0);
		return 1;
	}
	if (!lDelegate) {
		char cBuf[160];
		char *cEnd = NULL;
		double nNum;
		memcpy(cBuf, cTok, nLen);
		cBuf[nLen] = 0;
		errno = 0;
		nNum = strtod(cBuf, &cEnd);
		/* anything strtod is unhappy about — range, partial consumption —
		** goes to the real number() so the error is Ring's own */
		if (errno != 0 || cEnd != cBuf + nLen) {
			lDelegate = 1;
		} else {
			ring_list_adddouble_gc(pD->pState, pParent, nNum);
			return 1;
		}
	}
	pD->nTokAt = nStart;
	pD->nTokLen = nLen;
	pD->nStatus = 2;
	return 0;
}

static int rs_jd_object(RsJDec *pD, List *pParent) {
	List *pOut = ring_list_newlist_gc(pD->pState, pParent);
	List *pPair;
	int c;
	pD->nPos++; /* past the opening brace */
	if (rs_jd_skipws(pD) == '}') {
		pD->nPos++;
		return 1;
	}
	for (;;) {
		c = rs_jd_skipws(pD);
		if (c != '"') {
			rs_jd_fail(pD, "expected object key", (long)(pD->nPos + 1));
			return 0;
		}
		pPair = ring_list_newlist_gc(pD->pState, pOut);
		if (!rs_jd_string(pD, pPair)) {
			return 0;
		}
		if (rs_jd_skipws(pD) != ':') {
			rs_jd_fail(pD, "expected colon", (long)(pD->nPos + 1));
			return 0;
		}
		pD->nPos++;
		if (!rs_jd_value(pD, pPair)) {
			return 0;
		}
		c = rs_jd_skipws(pD);
		if (c == ',') {
			pD->nPos++;
		} else if (c == '}') {
			pD->nPos++;
			return 1;
		} else {
			rs_jd_fail(pD, "expected , or }", (long)(pD->nPos + 1));
			return 0;
		}
	}
}

static int rs_jd_array(RsJDec *pD, List *pParent) {
	List *pOut = ring_list_newlist_gc(pD->pState, pParent);
	int c;
	pD->nPos++; /* past the opening bracket */
	if (rs_jd_skipws(pD) == ']') {
		pD->nPos++;
		return 1;
	}
	for (;;) {
		if (!rs_jd_value(pD, pOut)) {
			return 0;
		}
		c = rs_jd_skipws(pD);
		if (c == ',') {
			pD->nPos++;
		} else if (c == ']') {
			pD->nPos++;
			return 1;
		} else {
			rs_jd_fail(pD, "expected , or ]", (long)(pD->nPos + 1));
			return 0;
		}
	}
}

/* jsnValue. null decodes as what `return NULL` produces in Ring.
**
** The depth cap replaces Ring's own stack check. The pure codec recurses
** on Ring's stack and its R4 fires between depth 300 and 350 (measured);
** recursing here on the wasm C stack instead would TRAP — a dead eval,
** not a catchable error. 320 sits inside the pure codec's own flip zone,
** and the raised text is exactly what the pure codec's R4 delivers.
** (Precise parity is unattainable in principle: Ring's threshold itself
** moves with how deep the caller already is.)
*/
static int rs_jd_value(RsJDec *pD, List *pParent) {
	int c = rs_jd_skipws(pD);
	if (pD->nPos >= pD->nSize) {
		rs_jd_fail(pD, "unexpected end of input", -1);
		return 0;
	}
	if (c == '{' || c == '[') {
		int lOk;
		if (pD->nDepth >= 320) {
			if (pD->nStatus == 1) {
				pD->nStatus = 0;
				snprintf(pD->cErr, sizeof(pD->cErr), "Error (R4) : Stack Overflow");
			}
			return 0;
		}
		pD->nDepth++;
		lOk = (c == '{') ? rs_jd_object(pD, pParent) : rs_jd_array(pD, pParent);
		pD->nDepth--;
		return lOk;
	}
	if (c == '"') {
		return rs_jd_string(pD, pParent);
	}
	if (c == 't') {
		if (!rs_jd_expect(pD, "true")) {
			return 0;
		}
		ring_list_adddouble_gc(pD->pState, pParent, 1.0);
		return 1;
	}
	if (c == 'f') {
		if (!rs_jd_expect(pD, "false")) {
			return 0;
		}
		ring_list_adddouble_gc(pD->pState, pParent, 0.0);
		return 1;
	}
	if (c == 'n') {
		if (!rs_jd_expect(pD, "null")) {
			return 0;
		}
		ring_list_addstring2_gc(pD->pState, pParent, "", 0);
		return 1;
	}
	return rs_jd_number(pD, pParent);
}

void rs_jsondecode_hook(void *pPointer) {
	RsJDec d;
	List *pRes;
	if (RING_API_PARACOUNT != 1) {
		RING_API_ERROR(RING_API_MISS1PARA);
		return;
	}
	if (!RING_API_ISSTRING(1)) {
		RING_API_ERROR(RING_API_BADPARATYPE);
		return;
	}
	memset(&d, 0, sizeof(d));
	d.pPointer = pPointer;
	d.pState = ((VM *)pPointer)->pRingState;
	d.cText = RING_API_GETSTRING(1);
	d.nSize = RING_API_GETSTRINGSIZE(1);
	d.nStatus = 1;
	pRes = RING_API_NEWLIST;
	ring_list_adddouble_gc(d.pState, pRes, 1.0); /* status slot */
	rs_jd_value(&d, pRes);
	free(d.sScratch.pData);
	if (d.nStatus == 1) {
		RING_API_RETLISTBYREF(pRes);
		return;
	}
	/* rebuild as [status, text] — parsing may have half-filled the list */
	while (ring_list_getsize(pRes) > 0) {
		ring_list_deleteitem_gc(d.pState, pRes, ring_list_getsize(pRes));
	}
	ring_list_adddouble_gc(d.pState, pRes, (double)d.nStatus);
	if (d.nStatus == 0) {
		ring_list_addstring2_gc(d.pState, pRes, d.cErr, (unsigned int)strlen(d.cErr));
	} else {
		ring_list_addstring2_gc(d.pState, pRes, d.cText + d.nTokAt, (unsigned int)d.nTokLen);
	}
	RING_API_RETLISTBYREF(pRes);
}
