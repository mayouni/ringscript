#include <emscripten.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include "ring.h"

/* Global buffer to capture output (512 KB) */
char final_output[1024 * 512];

/* --- HELPER: Safe append to the output buffer --- */
static void safe_append(const char *text) {
    if (!text) return;
    size_t current_len = strlen(final_output);
    size_t text_len    = strlen(text);
    if (current_len + text_len < sizeof(final_output) - 1) {
        strcat(final_output, text);
    }
}

/* --- HELPER: Number → String conversion --- */
static void append_number(double nValue) {
    char buf[64];
    if (nValue == (double)(long long)nValue) {
        sprintf(buf, "%lld", (long long)nValue);
    } else {
        sprintf(buf, "%g", nValue);
    }
    safe_append(buf);
}

/* --- HELPER: Recursive List serialization --- */
static void serialize_list(List *pList) {
    if (!pList) return;
    /* Using ring_list_getsize, which is the standard API in Ring 1.2.x */
    int nSize = ring_list_getsize(pList); 
    for (int i = 1; i <= nSize; i++) {
        if (ring_list_isstring(pList, i)) {
            safe_append(ring_list_getstring(pList, i));
            safe_append("\n");
        } else if (ring_list_isnumber(pList, i)) {
            /* Using double for numeric precision */
            append_number(ring_list_getdouble(pList, i));
            safe_append("\n");
        } else if (ring_list_islist(pList, i)) {
            serialize_list(ring_list_getlist(pList, i));
        }
    }
}

/* --- MAIN CALLBACK: Intercepting SEE (Business Logic Output) --- */
void my_ring_see(void *pPointer) {
    /* Capture strings */
    if (ring_vm_api_isstring(pPointer, 1)) {
        safe_append(ring_vm_api_getstring(pPointer, 1));
    } 
    /* Capture numbers (fix for len(), sum(), etc.) */
    else if (ring_vm_api_isnumber(pPointer, 1)) {
        append_number(ring_vm_api_getnumber(pPointer, 1));
    } 
    /* Capture lists */
    else if (ring_vm_api_islist(pPointer, 1)) {
        serialize_list(ring_vm_api_getlist(pPointer, 1));
    }
    /* Capture objects */
    else if (ring_vm_api_ispointer(pPointer, 1)) {
        safe_append("[Object]");
    }
}

/* --- ENTRY POINT: run_ring --- */
EMSCRIPTEN_KEEPALIVE
const char* run_ring(const char* ring_code) {
    final_output[0] = '\0';

    /* Stable initialization for WASM */
    RingState *pRingState = ring_state_init(); 
    if (!pRingState) return "Error: Failed to init RingState";

    /* Register output hook */
    ring_vm_funcregister("ring_vm_see", my_ring_see);
    
    /* Internal redirection of SEE to our C function */
    ring_state_runcode(pRingState, "func ringvm_see cData ring_vm_see(cData)");

    /* Execute business logic received from JavaScript */
    ring_state_runcode(pRingState, ring_code);

    ring_state_delete(pRingState);
    return final_output;
}
