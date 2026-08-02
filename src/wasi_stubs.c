/*
** RingScript — stubs for libc functions wasi-libc declares but does not
** define (WASI has no temp directories). Keeps the vendored Ring VM source
** untouched. Ring's tempfile() returns a NULL file pointer in the browser;
** tempname() is stubbed at the flag level (-D"mkstemp(x)=(-1)" in build.zig)
** and reports RING_VM_ERROR_TEMPFILENAME at runtime.
*/
#include <stdio.h>
#include "ring.h"

FILE *tmpfile(void) {
	return NULL;
}

/*
** Browser runtime has no filesystem: every fopen resolves against the
** embedded ringlib/ map baked into the wasm by the bridge (@embedFile).
** fmemopen gives the VM a real read-only FILE* over the embedded bytes,
** so the scanner (`load`), fexists and read() all work unmodified.
** Anything not embedded — and any write mode — fails like a missing file.
** The VM sources are compiled with -Dfopen=rs_fopen (build.zig), so every
** fopen in the vendored tree lands here without touching wasi-libc.
*/
extern const unsigned char *rs_find_embedded(const char *cPath, size_t *pLen);
FILE *fmemopen(void *buf, size_t size, const char *mode);

FILE *rs_fopen(const char *cPath, const char *cMode) {
	size_t nLen;
	const unsigned char *pData;
	if (cMode == NULL || cMode[0] != 'r') {
		return NULL;
	}
	pData = rs_find_embedded(cPath, &nLen);
	if (pData == NULL) {
		return NULL;
	}
	return fmemopen((void *)pData, nLen, "r");
}

/* 1 if the VM already auto-called main() (lCallMainFunction is a bitfield).
** The eval'd-code path triggers the VM's own auto-call only when the code
** contains a class; the bridge's auto-main pass consults this so main()
** never runs twice. */
unsigned int rs_vm_maincalled(void *pPointer) {
	VM *pVM = (VM *)pPointer;
	return pVM->lCallMainFunction;
}

/* Current decimals() setting (nDecimals is a bitfield — not addressable
** from Zig). The bridge formats see-hook numbers through the VM's own
** ring_general_numtostring with this, matching native output exactly. */
unsigned int rs_vm_decimals(void *pPointer) {
	VM *pVM = (VM *)pPointer;
	return pVM->nDecimals;
}

/*
** Value printers for the see hook — exact mirrors of the vendor printers
** (ring_list_print2_gc / ring_list_printobj_gc in rlist.c) but writing into
** the bridge output buffer instead of stdout: byte-exact strings (embedded
** NUL bytes survive), numbers via the live decimals() setting, objects as
** "attr: value" lines, "[This Attribute Contains A List]" / "Object..."
** markers, circular-reference guard, %p for pointers.
*/
extern void rs_append_output(const unsigned char *pData, size_t nLen);

static void rs_out_cstr(const char *cStr) {
	rs_append_output((const unsigned char *)cStr, strlen(cStr));
}

static void rs_out_number(void *pPointer, double nNum) {
	char cStr[RING_MEDIUMBUF + 8];
	ring_general_numtostring(nNum, cStr, ((VM *)pPointer)->nDecimals);
	rs_out_cstr(cStr);
}

void rs_print_list(void *pPointer, List *pList);

void rs_print_obj(void *pPointer, List *pList) {
	List *pList2, *pList3;
	unsigned int x;
	pList = RING_OBJECT_GETOBJECTDATA(pList);
	for (x = 3; x <= ring_list_getsize(pList); x++) {
		pList2 = ring_list_getlist(pList, x);
		rs_out_cstr(RING_VAR_GETNAME(pList2));
		rs_out_cstr(": ");
		if (RING_VAR_ISSTRING(pList2)) {
			rs_append_output((const unsigned char *)RING_VAR_GETSTRING(pList2),
					 RING_VAR_GETSTRINGSIZE(pList2));
			rs_out_cstr("\n");
		} else if (RING_VAR_ISNUMBER(pList2)) {
			rs_out_number(pPointer, RING_VAR_GETNUMBER(pList2));
			rs_out_cstr("\n");
		} else if (RING_VAR_ISLIST(pList2)) {
			pList3 = RING_VAR_GETLIST(pList2);
			if (ring_list_isobject(pList3)) {
				rs_out_cstr("Object...\n");
			} else {
				rs_out_cstr("[This Attribute Contains A List]\n");
			}
		}
	}
}

void rs_print_list(void *pPointer, List *pList) {
	unsigned int x;
	double y;
	List *pList2;
	char cStr[RING_MEDIUMBUF];
	for (x = 1; x <= ring_list_getsize(pList); x++) {
		if (ring_list_isstring(pList, x)) {
			rs_append_output((const unsigned char *)ring_list_getstring(pList, x),
					 ring_list_getstringsize(pList, x));
			rs_out_cstr("\n");
		} else if (ring_list_isnumber(pList, x)) {
			if (ring_list_isdouble(pList, x)) {
				y = ring_list_getdouble(pList, x);
				if (y == (int)y) {
					sprintf(cStr, "%.0f", y);
					rs_out_cstr(cStr);
					rs_out_cstr("\n");
				} else {
					rs_out_number(pPointer, y);
					rs_out_cstr("\n");
				}
			} else if (ring_list_isint(pList, x)) {
				sprintf(cStr, "%d", ring_list_getint(pList, x));
				rs_out_cstr(cStr);
				rs_out_cstr("\n");
			}
		} else if (ring_list_islist(pList, x)) {
			pList2 = ring_list_getlist(pList, x);
			if (ring_list_isobject(pList2)) {
				rs_print_obj(pPointer, pList2);
			} else if (ring_list_isref_gc(NULL, pList2)) {
				sprintf(cStr, "[...] (RC:%d)\n", ring_list_getrefcount_gc(NULL, pList2));
				rs_out_cstr(cStr);
			} else {
				rs_print_list(pPointer, pList2);
			}
		} else if (ring_list_ispointer(pList, x)) {
			sprintf(cStr, "%p\n", ring_list_getpointer(pList, x));
			rs_out_cstr(cStr);
		} else if (ring_list_isfuncpointer(pList, x)) {
			sprintf(cStr, "%p\n", ring_list_getfuncpointer(pList, x));
			rs_out_cstr(cStr);
		}
	}
}

/* see-hook dispatcher for list-or-object values */
void rs_print_value_list(void *pPointer, List *pList) {
	if (ring_list_isobject(pList)) {
		rs_print_obj(pPointer, pList);
	} else {
		rs_print_list(pPointer, pList);
	}
}

/* see of a raw pointer value */
void rs_print_pointer(void *pPointer, void *pValue) {
	char cStr[64];
	sprintf(cStr, "%p", pValue);
	rs_out_cstr(cStr);
}
