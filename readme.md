# RingScript WebAssembly Engine

***

## 1. Project Vision

This project aims to create **RingScript**: a headless Ring VM running in **WebAssembly** to power the **Softanza Web (stzweb)** framework.

**Goal**\
Replace JavaScript for business logic while keeping JS only for DOM/UI synchronization.\
All application logic is written in **Ring (`*.ring`)** and returns **JSON** to the frontend.

### Key Requirements

* ❌ No Qt Creator or Qt GUI dependencies

* ✅ Direct compilation using **Emscripten + Ring C source files**

* ✅ Pure logic engine (no window / GUI rendering)

* ✅ JSON-based communication between Ring and JavaScript

* ✅ Simple, maintainable architecture


## 2. Technical Architecture

### Final Working Structure

```
stzweb_project/
├── bridge.c              # C bridge between JS and Ring VM
├── build.bat             # Emscripten compilation script
├── index.html            # Web IDE interface
├── language/             # Ring 1.25 source code
│   ├── src/              # All Ring C implementation files
│   └── include/          # Ring headers (ring.h, ringapi.h)
├── ringscript.js         # Generated: Emscripten loader
└── ringscript.wasm       # Generated: Ring VM binary
```


## 3. Guide To Setup and Test This Beta Version of RingScript

## 3.1 Downloading the source files

Type this command in your console:
ringpm install ringsrcipt from mayouni

## 3.1 Toolset & Versions

The stability of the engine relies on a specific toolchain to ensure compatibility between Ring’s memory management and WebAssembly's linear memory.

* **Ring VM Core:** Version 1.25 (Source).

* **Emscripten (EMSDK):** Version 3.1.x+.

* **Clang (LLVM):** Version 19.x.

* **Operating System:** Windows 11.

***

## 3.2 Architecture: The Bridge Pattern

To communicate between JavaScript (the browser) and C (the Ring VM), we implemented a **Bridge Pattern**.

* **JavaScript Side:** Uses `ccall` to pass Ring code as a string to the C engine.

* **C Side (`bridge.c`):** Acts as the orchestrator, initializing the Ring State and registering custom functions.

* **The Buffer:** A 512 KB global `char` array (`final_output`) captures intercepted output to return to JavaScript.

***

## 3.3 Required Setup

To test or further develop the RingScript engine, follow these configuration steps:

### A. WebAssembly Environment (EMSDK)

1. **Install Emscripten:** Ensure the Emscripten SDK is installed (e.g., at `D:\wasm\emsdk`).

2. **Path Configuration:** The environment must have the following directories in the system `PATH`:

   * `D:\wasm\emsdk`

   * `D:\wasm\emsdk\upstream\emscripten`

3. **Activation:** Before building, run the environment setup script provided by EMSDK (`emsdk_env.bat`) to set variables like `EMSDK_NODE` and `EM_CONFIG`.

***

### B. Building the Engine

Use the provided `build.bat` file to compile the C bridge and the Ring VM source files into WebAssembly.

* **Build Command:** The batch script executes `emcc` with the necessary source files from the `language/src/` directory (e.g., `vm.c`, `vmgc.c`, `rlist.c`).

* **Output:** Successful compilation generates `ringscript.js` and `ringscript.wasm`.

***

### C. Launching the Editor

1. **Server Requirement:** WASM files must be served over HTTP/HTTPS. Use a local server (e.g., Live Server for VS Code or `python -m http.server`).

2. **Interface:** Open `index.html` in a modern web browser.

3. **Operation:**

   * The editor uses an `HTMLTextAreaElement` for code input.

   * Clicking **"Run Code"** triggers `Module.ccall('run_ring', ...)`, which passes the editor text to the WASM engine and displays the results in the output terminal.

***

## 4. Core Components

### 4.1 `bridge.c` (Final Working Version)

```c
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
```

#### Key Design Decisions

* Uses `ring_state_init()` instead of `ring_state_new()` for embedded mode

* Variable name **MUST** be `pRingState`\
  (required by `ring_vm_funcregister` macro)

* Captures `see` output via a custom C function instead of stdout/files

* Static buffer avoids memory access violations

***

### 4.2 `build.bat` (Emscripten Compilation)

```bat
set EMSDK_PATH=D:\wasm\emsdk
call "%EMSDK_PATH%\emsdk_env.bat"

emcc bridge.c [all Ring source files] -o ringscript.js ^
  -I language/include -I language/src ^
  -s EXPORTED_FUNCTIONS="['_run_ring']" ^
  -s EXPORTED_RUNTIME_METHODS="['ccall']" ^
  -s ALLOW_MEMORY_GROWTH=1 ^
  -s TOTAL_MEMORY=67108864 ^
  -s ASSERTIONS=1 ^
  -O2
```

#### Critical Flags

* `TOTAL_MEMORY=67108864` (64 MB)\
  → Prevents initialization crashes

* `ASSERTIONS=1`\
  → Detailed error messages during development

* `ALLOW_MEMORY_GROWTH=1`\
  → Dynamic memory allocation

* `-O2`\
  → Stable optimization (avoids pointer issues of `-O3`)

#### Ring Source Files Compiled

```
rstring.c, rlist.c, ritem.c, ritems.c, rhtable.c,
general.c, hashlib.c, state.c, scanner.c, parser.c,
codegen.c, objfile.c, vm.c, vmerror.c, vmeval.c,
vmexpr.c, vmgc.c, stmt.c, vmlists.c, vmoop.c,
vmrange.c, vmstack.c, vmstr.c, vmthread.c,
vmfuncs.c, vmvars.c, vmstate.c, vmexit.c,
vmperf.c, vmjump.c, vmtry.c, ringapi.c,
expr.c, ext.c, dll_e.c, genlib_e.c,
file_e.c, math_e.c, list_e.c, os_e.c,
meta_e.c, vminfo_e.c
```

***

### 4.3 `index.html` (Web IDE)

* Split-pane editor with line numbers

* Resizable panels (code editor | console output)

* Calls

  ```js
  Module.ccall('run_ring', 'string', ['string'], [code])
  ```

* Waits for `Module.onRuntimeInitialized` before enabling execution

***

## 5. Technical Challenges Resolved

### Challenge 1: Memory Access Out of Bounds (`0x11be2`)

**Symptom**\
Crash on `ring_state_new()` or during execution

**Root Cause**\
Ring VM attempts to access OS resources (argc/argv, env vars, filesystem)\
→ Not available in browser sandbox

**Failed Attempts**

* ❌ Manually setting `pState->argc / argv` (members don’t exist)

* ❌ Setting `pState->nRingContext = 1` (member doesn’t exist)

* ❌ Redirecting stdout using `freopen()` (no filesystem)

✅ **Final Solution**\
Use `ring_state_init()` + custom `ring_vm_funcregister()` to bypass OS dependencies

***

### Challenge 2: `ring_vm_funcregister` Compilation Error

**Symptom**

```
error: use of undeclared identifier 'pRingState'
```

**Root Cause**

```c
#define ring_vm_funcregister(cName, pFunc) \
    ring_vm_funcregister2(pRingState, cName, pFunc)
```

**Solution**\
The variable **must be named exactly** `pRingState`\
(`pState` will not work)

***

### Challenge 3: Emscripten Version Compatibility

* `STACK_SIZE` → ❌ Not recognized\
  → Use `TOTAL_STACK` or omit

* `INITIAL_MEMORY` → ❌ Deprecated\
  → Use `TOTAL_MEMORY`

* `language/src/*.c` → ❌ Not expanded in Windows CMD\
  → Files must be listed explicitly

***

### Challenge 4: Build Script Closing Immediately

**Cause**

* Syntax errors

* Missing `pause`

**Solution**

* Add `pause` at end

* Use `cmd /c` for `emcc`

* Check `%ERRORLEVEL%`

***

### Challenge 5: Browser Cache

**Issue**\
Old `.wasm` file cached after recompilation

**Solution**

* `Ctrl + F5`

* Or use Incognito mode

***

## 6. Current Status

### ✅ Working

* Basic Ring execution (loops, variables, arithmetic)

* `see` output capture

* String concatenation

* Function definitions and calls

* Basic list operations

***

### ⚠️ Untested

* Classes, OOP, packages

* File I/O (likely unsupported)

* External library loading (`load`)

* Error handling & exceptions

* Large data structures (memory limits)

* Multiple concurrent VM instances

***

### ❌ Not Implemented

* Loading external `.ring` files (critical for stzweb)

* Virtual filesystem for Ring modules

* JSON serialization helpers (Ring ↔ JS)

* Error reporting (currently silent failures)

* Debugging capabilities

* Performance profiling

* 

## 7. Important Notice — Not Production Ready

This version of **RingScript WebAssembly Engine** is **not production-ready**.

It was created by **Mansour Ayouni**, creator of the **Softanza library for Ring**, using AI assistance.\
The author has **no prior experience with C, assembly, or low-level systems programming**.

The goal of this work is to **encourage skilled members of the Ring community** to explore, review, and improve this prototype, and help evolve it into a more robust and production-ready solution.