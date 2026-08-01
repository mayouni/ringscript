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

/*
** ring_list_getsize/getstring/getdouble are macros in rlist.h (direct struct
** access), so the Zig bridge cannot declare them extern. Real-function
** wrappers for the bridge:
*/
unsigned int rs_list_getsize(List *pList) {
	return ring_list_getsize(pList);
}

char *rs_list_getstring(List *pList, unsigned int nIndex) {
	return ring_list_getstring(pList, nIndex);
}

double rs_list_getdouble(List *pList, unsigned int nIndex) {
	return ring_list_getdouble(pList, nIndex);
}

/* Current VM line number (RING_VM_IR_GETLINENUMBER is a struct-access macro). */
unsigned int rs_vm_line(void *pPointer) {
	VM *pVM = (VM *)pPointer;
	return pVM->nLineNumber;
}
