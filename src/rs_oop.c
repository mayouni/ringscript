/*
** RingScript — the object template cache (docs/HEADROOM_PLAN.md P5).
**
** `new X` on an attributes-only class costs 31x a Lua table (rivals.md),
** and the cost is machinery: every instantiation saves the VM state,
** pushes the class package, jumps into the class-region bytecode to
** execute one statement per attribute, then unwinds it all through
** SETSCOPE. For `class point x y z` that work produces the same three
** NULL attributes every single time.
**
** This cache proves — once per class, by scanning its region BYTECODE —
** that the region consists solely of bare attribute definitions, records
** the attribute names (they are static operands of the LoadA
** instructions), and then builds every later object directly: super
** object, then one [name, STRING, "NULL"] variable per attribute, which
** is byte-for-byte what executing the region produces. The savestate /
** region / restorestate round trip is skipped whole, and the SETSCOPE
** that statically follows every New instruction is stepped over, because
** there is no saved state for it to restore.
**
** What makes this safe rather than brave:
**   · Eligibility is STATIC. Any opcode in the region beyond the bare-
**     attribute pattern (Class, NewLabel, FileName, NewLine, then
**     LoadA/PushV/FreeStack triplets, ReturnNull) disqualifies the class
**     forever: defaults, private sections, executable statements, and
**     anything else take the normal path. Parented classes never enter.
**   · init() and `new x { }` braces are unaffected: the -ins traces show
**     both run AFTER SetScope, on the completed object, through their own
**     machinery this path never touches.
**   · The replay changes nothing that restorestate would have restored —
**     stack pointer, active scope, flags all stay untouched — so
**     replaying is observationally the save/nothing/restore round trip.
**   · The gates' oop phase (written and verified against the unpatched
**     VM) plus the full oracle battery hold fast-path objects
**     indistinguishable from slow-path ones.
**
** The cache is keyed by class-list pointer and cleared by rs_reset (the
** only way class lists ever die). Lives entirely in RingScript's own C —
** the vendor patch is a single guarded call in ring_vm_oop_newobj.
*/
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include "ring.h"

#define RS_OC_SLOTS 512      /* power of two; full table just bypasses */
#define RS_OC_MAXATTRS 48
#define RS_OC_MAXSCAN 256    /* region longer than this: not our case  */

#define RS_OC_UNKNOWN 0
#define RS_OC_ELIGIBLE 1
#define RS_OC_NO 2

typedef struct RsOcEntry {
	const List *pClass;
	const char **aNames; /* nAttrs operand strings, owned by the bytecode */
	unsigned short nAttrs;
	unsigned char nState;
} RsOcEntry;

static RsOcEntry aRsOc[RS_OC_SLOTS];

static RsOcEntry *rs_oc_slot(const List *pClass) {
	size_t h = ((size_t)pClass >> 4) * 2654435761u;
	unsigned int i, nAt;
	for (i = 0; i < 8; i++) {
		nAt = (unsigned int)((h + i) & (RS_OC_SLOTS - 1));
		if (aRsOc[nAt].pClass == pClass || aRsOc[nAt].pClass == NULL) {
			return &aRsOc[nAt];
		}
	}
	return NULL; /* probe run full: treat as uncacheable */
}

/* Called by the bridge on rs_reset: the state dies, and every class-list
** pointer (and every bytecode operand string aNames borrows) dies with it. */
void rs_objcache_clear(void) {
	unsigned int i;
	for (i = 0; i < RS_OC_SLOTS; i++) {
		free((void *)aRsOc[i].aNames);
		aRsOc[i].pClass = NULL;
		aRsOc[i].aNames = NULL;
		aRsOc[i].nAttrs = 0;
		aRsOc[i].nState = RS_OC_UNKNOWN;
	}
}

/* One pass over the region bytecode: is it bare attributes only, and if
** so, which names? The region starts at the class's PC (the Class opcode)
** and ends at its ReturnNull. */
static void rs_oc_scan(VM *pVM, RsOcEntry *pE, unsigned int nClassPC) {
	const char *aNames[RS_OC_MAXATTRS];
	unsigned int nAttrs = 0, nOps = 0, nPC = nClassPC;
	ByteCode *pIR;
	pE->nState = RS_OC_NO;
	if (nPC < 1 || nPC > RING_VM_INSTRUCTIONSCOUNT) {
		return;
	}
	pIR = pVM->pByteCode + nPC - 1;
	if (pIR->nOPCode != ICO_NEWCLASS) {
		return;
	}
	nPC++;
	while (nPC <= RING_VM_INSTRUCTIONSCOUNT && nOps++ < RS_OC_MAXSCAN) {
		pIR = pVM->pByteCode + nPC - 1;
		switch (pIR->nOPCode) {
		case ICO_NEWLABEL:
		case ICO_FILENAME:
		case ICO_NEWLINE:
			nPC++;
			break;
		case ICO_LOADADDRESS:
			/* a bare attribute is exactly LoadA name / PushV / FreeStack */
			if (nPC + 2 > RING_VM_INSTRUCTIONSCOUNT ||
			    pVM->pByteCode[nPC].nOPCode != ICO_PUSHV ||
			    pVM->pByteCode[nPC + 1].nOPCode != ICO_FREESTACK ||
			    nAttrs >= RS_OC_MAXATTRS || pIR->aReg[0].pString == NULL) {
				return;
			}
			aNames[nAttrs++] = pIR->aReg[0].pString;
			nPC += 3;
			break;
		case ICO_RETNULL: {
			/* clean end of a bare region. Two static disqualifiers first:
			** a repeated name (the region's LoadA finds the first and
			** SKIPS the second — one attribute, not two), and the names
			** the object scope predefines, which a region LoadA would
			** find instead of creating */
			unsigned int a, b;
			for (a = 0; a < nAttrs; a++) {
				if (strcmp(aNames[a], "self") == 0 || strcmp(aNames[a], "super") == 0 ||
				    strcmp(aNames[a], "this") == 0) {
					return;
				}
				for (b = a + 1; b < nAttrs; b++) {
					if (strcmp(aNames[a], aNames[b]) == 0) {
						return;
					}
				}
			}
			pE->aNames = (const char **)malloc(sizeof(char *) * (nAttrs ? nAttrs : 1));
			if (pE->aNames == NULL) {
				return;
			}
			memcpy((void *)pE->aNames, aNames, sizeof(char *) * nAttrs);
			pE->nAttrs = (unsigned short)nAttrs;
			pE->nState = RS_OC_ELIGIBLE;
			return;
		}
		default:
			return; /* defaults, private, code — the normal path's job */
		}
	}
}

/*
** The call the vendor patch makes, placed where ring_vm_oop_newobj is
** about to save state and jump into the region. pList3 already holds the
** freshly created `self`. Returns 1 when the object was completed here
** (caller returns immediately), 0 for the normal path.
*/
unsigned int rs_objcache_new(VM *pVM, List *pClassList, List *pStateList, unsigned int nClassPC) {
	RsOcEntry *pE;
	List *pAttr;
	unsigned int i;
	/* only the plain shape: top-level new (not inside another class
	** region), no parent class, and the SETSCOPE that pairs with the
	** region sitting statically next — every -ins trace shape has it
	** there, but a guard is cheaper than a belief */
	if (pVM->nInClassRegion != 0) {
		return 0;
	}
	if (strcmp(ring_list_getstring(pClassList, RING_CLASSMAP_PARENTCLASS), RING_CSTR_EMPTY) != 0) {
		return 0;
	}
	if (pVM->nPC < 1 || pVM->nPC > RING_VM_INSTRUCTIONSCOUNT ||
	    pVM->pByteCode[pVM->nPC - 1].nOPCode != ICO_SETSCOPE) {
		return 0;
	}
	pE = rs_oc_slot(pClassList);
	if (pE == NULL) {
		return 0;
	}
	if (pE->pClass == NULL) {
		pE->pClass = pClassList;
		pE->nState = RS_OC_UNKNOWN;
	}
	if (pE->nState == RS_OC_UNKNOWN) {
		rs_oc_scan(pVM, pE, nClassPC);
	}
	if (pE->nState != RS_OC_ELIGIBLE) {
		return 0;
	}
	/* Ring's documented conflict rule (Scope Rules > "Conflict between
	** Global Variables and Class Attributes"): a region LoadA that FINDS a
	** visible variable does not create the attribute — the doc-snippet
	** oracle caught the difference. During region execution visibility is
	** the object state (empty but for self/super, excluded statically
	** above), the defined globals, and the global scope. Any hit: take the
	** normal path, whose machinery produces the documented behavior. */
	for (i = 0; i < pE->nAttrs; i++) {
		if (ring_vm_findvarusinghashtable(pVM, pVM->pDefinedGlobals, pE->aNames[i]) != NULL ||
		    ring_vm_findvarusinghashtable(pVM, ring_vm_getglobalscope(pVM), pE->aNames[i]) != NULL) {
			return 0;
		}
	}
	/* replay: exactly what newobj + the region build, in the same order —
	** super first (newobj creates it before the region runs), then one
	** in-region-style variable per attribute */
	ring_vm_oop_newsuperobj(pVM, pStateList, pClassList);
	for (i = 0; i < pE->nAttrs; i++) {
		pAttr = ring_vm_newvar2(pVM, pE->aNames[i], pStateList);
		/* in-region newvar makes STRING "NULL"; outside it makes
		** NULL "NULL" — flip the type to match the region exactly */
		RING_VAR_SETTYPE(pAttr, RING_VM_STRING);
	}
	/* step over the SETSCOPE: there is no saved state for it to restore */
	pVM->nPC++;
	return 1;
}
