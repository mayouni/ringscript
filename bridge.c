#include <emscripten.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include "ring.h"

/* Buffer global pour capturer la sortie (512 KB) */
char final_output[1024 * 512];

/* --- HELPER : Ajout sÃ©curisÃ© au buffer --- */
static void safe_append(const char *text) {
    if (!text) return;
    size_t current_len = strlen(final_output);
    size_t text_len    = strlen(text);
    if (current_len + text_len < sizeof(final_output) - 1) {
        strcat(final_output, text);
    }
}

/* --- HELPER : Conversion Nombre -> String --- */
static void append_number(double nValue) {
    char buf[64];
    if (nValue == (double)(long long)nValue) {
        sprintf(buf, "%lld", (long long)nValue);
    } else {
        sprintf(buf, "%g", nValue);
    }
    safe_append(buf);
}

/* --- HELPER : SÃ©rialisation rÃ©cursive des Listes --- */
static void serialize_list(List *pList) {
    if (!pList) return;
    /* Utilisation de ring_list_getsize qui est le standard Ring 1.2.x */
    int nSize = ring_list_getsize(pList); 
    for (int i = 1; i <= nSize; i++) {
        if (ring_list_isstring(pList, i)) {
            safe_append(ring_list_getstring(pList, i));
            safe_append("\n");
        } else if (ring_list_isnumber(pList, i)) {
            /* Utilisation de double pour la prÃ©cision des nombres */
            append_number(ring_list_getdouble(pList, i));
            safe_append("\n");
        } else if (ring_list_islist(pList, i)) {
            serialize_list(ring_list_getlist(pList, i));
        }
    }
}

/* --- CALLBACK PRINCIPAL : Interception du SEE (Logiciel MÃ©tier) --- */
void my_ring_see(void *pPointer) {
    /* Capture des Strings */
    if (ring_vm_api_isstring(pPointer, 1)) {
        safe_append(ring_vm_api_getstring(pPointer, 1));
    } 
    /* Capture des Nombres (Fix pour len(), sum(), etc.) */
    else if (ring_vm_api_isnumber(pPointer, 1)) {
        append_number(ring_vm_api_getnumber(pPointer, 1));
    } 
    /* Capture des Listes */
    else if (ring_vm_api_islist(pPointer, 1)) {
        serialize_list(ring_vm_api_getlist(pPointer, 1));
    }
    /* Capture des Objets */
    else if (ring_vm_api_ispointer(pPointer, 1)) {
        safe_append("[Object]");
    }
}

/* --- POINT D'ENTRÃ‰E : run_ring --- */
EMSCRIPTEN_KEEPALIVE
const char* run_ring(const char* ring_code) {
    final_output[0] = '\0';

    /* Initialisation stable pour WASM */
    RingState *pRingState = ring_state_init(); 
    if (!pRingState) return "Error: Failed to init RingState";

    /* Enregistrement du hook de sortie */
    ring_vm_funcregister("ring_vm_see", my_ring_see);
    
    /* Redirection interne de SEE vers notre fonction C */
    ring_state_runcode(pRingState, "func ringvm_see cData ring_vm_see(cData)");

    /* ExÃ©cution de la logique mÃ©tier transmise par JS */
    ring_state_runcode(pRingState, ring_code);

    ring_state_delete(pRingState);
    return final_output;
}