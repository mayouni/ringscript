/*
** RingScript loader — minimal WASI browser shim + rs_* API wrapper.
** Works in browsers and Node (anything with WebAssembly + TextDecoder).
**
** Usage:
**   const ring = await RingScript.load("ringscript.wasm", {
**     onOutput: text => ...   // stdout/stderr from the VM (errors, printf)
**   });
**   ring.eval('see 1+2');     // -> { ok: true, output: "3", error: "" }
*/
(function (global) {
    "use strict";

    const WASI_ESUCCESS = 0;
    const WASI_EBADF = 8;
    const WASI_ENOSYS = 52;

    function makeWasi(getMemory, onOutput) {
        const decoder = new TextDecoder("utf-8");

        function view() {
            return new DataView(getMemory().buffer);
        }
        function bytes() {
            return new Uint8Array(getMemory().buffer);
        }

        const wasi = {
            fd_write(fd, iovsPtr, iovsLen, nwrittenPtr) {
                const dv = view();
                const mem = bytes();
                let written = 0;
                let text = "";
                for (let i = 0; i < iovsLen; i++) {
                    const ptr = dv.getUint32(iovsPtr + i * 8, true);
                    const len = dv.getUint32(iovsPtr + i * 8 + 4, true);
                    text += decoder.decode(mem.subarray(ptr, ptr + len));
                    written += len;
                }
                if (text.length > 0) onOutput(text, fd);
                dv.setUint32(nwrittenPtr, written, true);
                return WASI_ESUCCESS;
            },
            fd_read(fd, iovsPtr, iovsLen, nreadPtr) {
                view().setUint32(nreadPtr, 0, true);
                return WASI_ESUCCESS; // EOF on stdin
            },
            fd_close() { return WASI_ESUCCESS; },
            fd_seek(fd, offsetLo, offsetHi, whence, newOffsetPtr) {
                return WASI_EBADF;
            },
            fd_fdstat_get(fd, bufPtr) {
                const dv = view();
                // filetype = character_device(2), zero flags/rights
                dv.setUint8(bufPtr, 2);
                dv.setUint8(bufPtr + 1, 0);
                dv.setUint16(bufPtr + 2, 0, true);
                dv.setBigUint64(bufPtr + 8, 0n, true);
                dv.setBigUint64(bufPtr + 16, 0n, true);
                return WASI_ESUCCESS;
            },
            fd_fdstat_set_flags() { return WASI_ESUCCESS; },
            fd_prestat_get() { return WASI_EBADF; },       // no preopened dirs
            fd_prestat_dir_name() { return WASI_EBADF; },
            path_open() { return WASI_ENOSYS; },
            path_filestat_get() { return WASI_ENOSYS; },
            path_unlink_file() { return WASI_ENOSYS; },
            path_rename() { return WASI_ENOSYS; },
            path_create_directory() { return WASI_ENOSYS; },
            path_remove_directory() { return WASI_ENOSYS; },
            fd_filestat_get() { return WASI_ENOSYS; },
            fd_readdir() { return WASI_ENOSYS; },
            clock_time_get(clockId, precisionLo, precisionHi, timePtr) {
                const ns = BigInt(Math.round(Date.now() * 1e6));
                view().setBigUint64(timePtr, ns, true);
                return WASI_ESUCCESS;
            },
            clock_res_get(clockId, resPtr) {
                view().setBigUint64(resPtr, 1000000n, true);
                return WASI_ESUCCESS;
            },
            random_get(ptr, len) {
                const mem = bytes().subarray(ptr, ptr + len);
                if (typeof crypto !== "undefined" && crypto.getRandomValues) {
                    // getRandomValues caps at 64 KB per call
                    for (let i = 0; i < len; i += 65536) {
                        crypto.getRandomValues(mem.subarray(i, Math.min(i + 65536, len)));
                    }
                } else {
                    for (let i = 0; i < len; i++) mem[i] = (Math.random() * 256) | 0;
                }
                return WASI_ESUCCESS;
            },
            environ_sizes_get(countPtr, sizePtr) {
                const dv = view();
                dv.setUint32(countPtr, 0, true);
                dv.setUint32(sizePtr, 0, true);
                return WASI_ESUCCESS;
            },
            environ_get() { return WASI_ESUCCESS; },
            args_sizes_get(countPtr, sizePtr) {
                const dv = view();
                dv.setUint32(countPtr, 0, true);
                dv.setUint32(sizePtr, 0, true);
                return WASI_ESUCCESS;
            },
            args_get() { return WASI_ESUCCESS; },
            proc_exit(code) {
                throw new Error("Ring VM called proc_exit(" + code + ")");
            },
        };

        // Anything not implemented above: report ENOSYS instead of crashing,
        // and log once so gaps are visible during development.
        const warned = new Set();
        return new Proxy(wasi, {
            get(target, prop) {
                if (prop in target) return target[prop];
                return function () {
                    if (!warned.has(prop)) {
                        warned.add(prop);
                        console.warn("[ringscript] unimplemented WASI call:", prop);
                    }
                    return WASI_ENOSYS;
                };
            },
        });
    }

    async function load(source, opts) {
        opts = opts || {};
        const onOutput = opts.onOutput || function (t) { console.log(t); };

        let memory = null;
        const wasi = makeWasi(function () { return memory; }, onOutput);

        let wasmModule;
        if (source instanceof ArrayBuffer || (typeof Buffer !== "undefined" && Buffer.isBuffer && Buffer.isBuffer(source))) {
            wasmModule = await WebAssembly.instantiate(source, { wasi_snapshot_preview1: wasi });
        } else if (typeof fetch === "function") {
            const resp = await fetch(source);
            if (WebAssembly.instantiateStreaming) {
                wasmModule = await WebAssembly.instantiateStreaming(resp, { wasi_snapshot_preview1: wasi });
            } else {
                wasmModule = await WebAssembly.instantiate(await resp.arrayBuffer(), { wasi_snapshot_preview1: wasi });
            }
        } else {
            throw new Error("RingScript.load: pass an ArrayBuffer in this environment");
        }

        const instance = wasmModule.instance || wasmModule;
        const ex = instance.exports;
        memory = ex.memory;

        // WASI reactor model: run C runtime constructors once.
        if (typeof ex._initialize === "function") ex._initialize();

        const encoder = new TextEncoder();
        const decoder = new TextDecoder("utf-8");

        function readCString(ptr) {
            if (!ptr) return "";
            const mem = new Uint8Array(memory.buffer);
            let end = ptr;
            while (mem[end] !== 0) end++;
            return decoder.decode(mem.subarray(ptr, end));
        }

        function withCString(str, fn) {
            const data = encoder.encode(str);
            const ptr = ex.rs_alloc(data.length + 1);
            if (!ptr) throw new Error("RingScript: rs_alloc failed");
            const mem = new Uint8Array(memory.buffer);
            mem.set(data, ptr);
            mem[ptr + data.length] = 0;
            try {
                return fn(ptr);
            } finally {
                ex.rs_free(ptr, data.length + 1);
            }
        }

        const api = {
            instance: instance,
            init() { return ex.rs_init(); },
            reset() { return ex.rs_reset(); },
            eval(code) {
                const rc = withCString(code, function (ptr) { return ex.rs_eval(ptr); });
                return {
                    ok: rc === 0,
                    code: rc,
                    output: readCString(ex.rs_last_output()),
                    error: readCString(ex.rs_last_error()),
                };
            },
            lastOutput() { return readCString(ex.rs_last_output()); },
            lastError() { return readCString(ex.rs_last_error()); },
        };

        const rc = api.init();
        if (rc !== 0) throw new Error("RingScript: rs_init failed (" + rc + ")");
        return api;
    }

    const RingScript = { load: load };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = RingScript;
    }
    global.RingScript = RingScript;
})(typeof globalThis !== "undefined" ? globalThis : this);
