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

    function makeWasi(getMemory, onOutput, sink) {
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
                let written = 0;
                if (sink) {
                    for (let i = 0; i < iovsLen; i++) {
                        const ptr = dv.getUint32(iovsPtr + i * 8, true);
                        const len = dv.getUint32(iovsPtr + i * 8 + 4, true);
                        if (len > 0) sink(ptr, len, fd);
                        written += len;
                    }
                    // re-fetch: the sink re-enters wasm and memory may grow
                    view().setUint32(nwrittenPtr, written, true);
                    return WASI_ESUCCESS;
                }
                const mem = bytes();
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
            // offset is a wasm i64 -> a single BigInt argument in JS
            fd_seek(fd, offset, whence, newOffsetPtr) {
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
            // precision is a wasm i64 -> a single BigInt argument in JS
            // (a 4-arg signature here would write the time to the wrong
            // address and freeze clock()/time() at stale values)
            clock_time_get(clockId, precision, timePtr) {
                // CLOCK_MONOTONIC(1)/PROCESS_CPUTIME(2)/THREAD_CPUTIME(3):
                // performance.now() keeps clock() advancing sub-ms; REALTIME(0)
                // uses the wall clock for time()/date().
                const ms = clockId === 0 ? Date.now()
                    : (typeof performance !== "undefined" ? performance.now() : Date.now());
                view().setBigUint64(timePtr, BigInt(Math.round(ms * 1e6)), true);
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
        let exports = null;
        // captureStdout: route C-level stdout/stderr (print(), puts(), VM
        // error prints) back into the wasm output buffer via
        // rs_append_output, preserving true order relative to `see` output.
        // The raw bytes are already in wasm memory, so the sink re-enters
        // the instance with the original pointers.
        const sink = opts.captureStdout
            ? function (ptr, len, fd) { exports.rs_append_output(ptr, len); }
            : null;
        const wasi = makeWasi(function () { return memory; }, onOutput, sink);
        const encoder = new TextEncoder();
        const decoder = new TextDecoder("utf-8");

        // Ring -> JS seam: Ring's jscall(name, json) lands here. Handlers are
        // registered with api.on(name, fn); unhandled calls fall through to a
        // DOM CustomEvent "ringscript:<name>" in browsers. A handler's return
        // value (JSON-serializable) is passed back to Ring.
        const handlers = Object.create(null);
        function js_dispatch(namePtr, nameLen, jsonPtr, jsonLen) {
            const mem = new Uint8Array(memory.buffer);
            const name = decoder.decode(mem.subarray(namePtr, namePtr + nameLen));
            const raw = decoder.decode(mem.subarray(jsonPtr, jsonPtr + jsonLen));
            let payload = null;
            try { payload = raw.length ? JSON.parse(raw) : null; } catch (e) { payload = raw; }
            let result;
            if (handlers[name]) {
                result = handlers[name](payload);
            } else if (typeof document !== "undefined") {
                document.dispatchEvent(new CustomEvent("ringscript:" + name, { detail: payload }));
            }
            if (result === undefined || result === null) return 0;
            const bytes = encoder.encode(JSON.stringify(result));
            const ptr = exports.rs_alloc(bytes.length + 1);
            if (!ptr) return 0;
            const out = new Uint8Array(memory.buffer); // buffer may have grown
            out.set(bytes, ptr);
            out[ptr + bytes.length] = 0;
            return ptr;
        }

        // Ring's `give` when the eval's input queue is empty: ask the page,
        // live. opts.onGive() may supply a line (return null/undefined for
        // "no input"); the browser default is window.prompt, so interactive
        // Ring programs simply pause and ask the user. Returns a wasm
        // pointer to a NUL-terminated copy (the bridge frees it), 0 if none.
        function js_give() {
            let v;
            if (opts.onGive) {
                v = opts.onGive();
            } else if (typeof window !== "undefined" && typeof window.prompt === "function") {
                // Show the program's own pending question: the tail of the
                // output produced so far in this eval (e.g. "Enter your name:").
                let msg = "";
                try {
                    const len = exports.rs_last_output_size();
                    if (len) {
                        const ptr = exports.rs_last_output();
                        const all = decoder.decode(new Uint8Array(memory.buffer).subarray(ptr, ptr + len));
                        msg = all.slice(-400).trim();
                    }
                } catch (e) { /* fall through to the generic label */ }
                v = window.prompt(msg || "The Ring program asks for input:");
            }
            if (v === undefined || v === null) return 0;
            const bytes = encoder.encode(String(v));
            const ptr = exports.rs_alloc(bytes.length + 1);
            if (!ptr) return 0;
            const mem = new Uint8Array(memory.buffer);
            mem.set(bytes, ptr);
            mem[ptr + bytes.length] = 0;
            return ptr;
        }

        const imports = {
            wasi_snapshot_preview1: wasi,
            ringscript: { js_dispatch: js_dispatch, js_give: js_give },
        };

        let wasmModule;
        if (source instanceof ArrayBuffer || (typeof Buffer !== "undefined" && Buffer.isBuffer && Buffer.isBuffer(source))) {
            wasmModule = await WebAssembly.instantiate(source, imports);
        } else if (typeof fetch === "function") {
            const resp = await fetch(source);
            if (WebAssembly.instantiateStreaming) {
                try {
                    wasmModule = await WebAssembly.instantiateStreaming(resp, imports);
                } catch (e) {
                    // Server sent a non-wasm MIME type; refetch and instantiate from bytes.
                    const resp2 = await fetch(source);
                    wasmModule = await WebAssembly.instantiate(await resp2.arrayBuffer(), imports);
                }
            } else {
                wasmModule = await WebAssembly.instantiate(await resp.arrayBuffer(), imports);
            }
        } else {
            throw new Error("RingScript.load: pass an ArrayBuffer in this environment");
        }

        const instance = wasmModule.instance || wasmModule;
        const ex = instance.exports;
        exports = ex;
        memory = ex.memory;

        // WASI reactor model: run C runtime constructors once.
        if (typeof ex._initialize === "function") ex._initialize();

        function readCString(ptr) {
            if (!ptr) return "";
            const mem = new Uint8Array(memory.buffer);
            let end = ptr;
            while (mem[end] !== 0) end++;
            return decoder.decode(mem.subarray(ptr, end));
        }

        // Binary-safe: Ring output may contain NUL bytes (e.g. int2bytes),
        // so read the exact byte length instead of stopping at NUL.
        function readOutput() {
            const len = ex.rs_last_output_size();
            if (!len) return "";
            const ptr = ex.rs_last_output();
            return decoder.decode(new Uint8Array(memory.buffer).subarray(ptr, ptr + len));
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
            /// RingScript's version, read from the wasm actually loaded.
            version: ex.rs_version ? readCString(ex.rs_version()) : "unknown",
            init() { return ex.rs_init(); },
            reset() { return ex.rs_reset(); },
            /// eval(code[, input]) — `input` is the text queue served to
            /// Ring's `give`, line by line. Each eval starts with a fresh
            /// queue (empty when the argument is omitted). CRLF is
            /// normalized to LF, matching native Ring's text-mode reads.
            eval(code, input) {
                withCString((input || "").replace(/\r\n/g, "\n"), function (ptr) { ex.rs_set_input(ptr); });
                const rc = withCString(String(code).replace(/\r\n/g, "\n"), function (ptr) { return ex.rs_eval(ptr); });
                return {
                    ok: rc === 0,
                    code: rc,
                    output: readOutput(),
                    error: readCString(ex.rs_last_error()),
                };
            },
            lastOutput() { return readOutput(); },
            lastError() { return readCString(ex.rs_last_error()); },
            /// Call a Ring function with one JSON-serializable argument;
            /// returns { ok, result (parsed), output, error }.
            call(fname, arg) {
                const json = JSON.stringify(arg === undefined ? null : arg);
                const resPtr = withCString(fname, function (fp) {
                    return withCString(json, function (jp) {
                        return ex.rs_call(fp, jp);
                    });
                });
                const raw = readCString(resPtr);
                const error = readCString(ex.rs_last_error());
                let result = null;
                if (!error && raw.length) {
                    try { result = JSON.parse(raw); } catch (e) { result = raw; }
                }
                return {
                    ok: !error,
                    result: result,
                    output: readOutput(),
                    error: error,
                };
            },
            /// Register a JS handler for Ring's jscall(name, json).
            on(name, fn) { handlers[name] = fn; return api; },
        };

        const rc = api.init();
        if (rc !== 0) throw new Error("RingScript: rs_init failed (" + rc + ")");
        return api;
    }

    /*
    ** boot([opts]) — the "script your page in Ring" mode. Loads the wasm
    ** (default "ringscript.wasm" next to your HTML), registers a minimal
    ** DOM seam, runs every <script type="text/ring"> block in document
    ** order, and exposes the instance as window.ring so page controls can
    ** call Ring functions directly: onclick="ring.call('MyFunc')".
    **
    ** Blocks may be inline or carry a src, the way ordinary scripts do:
    **   <script type="text/ring" src="helpers.ring"></script>
    **   <script type="text/ring">? Greet("Mansour")</script>
    ** They run in the order they appear, each finishing before the next
    ** starts, so a file may rely on whatever earlier ones defined.
    **
    ** The DOM seam, callable from Ring via Platform(name, data):
    **   Platform("settext",  [ :id = "x", :text = v ])   set an element's text
    **   Platform("gettext",  [ :id = "x" ])              read an element's text
    **   Platform("getvalue", [ :id = "x" ])              read an input's value
    ** Anything else: register your own with ring.on(name, fn).
    **
    ** Note: functions invoked with ring.call receive exactly one argument
    ** (the JSON payload, NULL when omitted) — declare them as `func F aArg`.
    */
    async function boot(opts) {
        opts = opts || {};
        const ring = await load(opts.wasm || "ringscript.wasm", opts);
        ring.on("settext", function (p) {
            const el = document.getElementById(p && p.id);
            if (el) el.textContent = (p && p.text != null) ? String(p.text) : "";
            return 1;
        });
        ring.on("gettext", function (p) {
            const el = document.getElementById(p && p.id);
            return el ? el.textContent : "";
        });
        ring.on("getvalue", function (p) {
            const el = document.getElementById(p && p.id);
            return el ? el.value : "";
        });
        // Every <script type="text/ring"> on the page, in document order.
        // With a src attribute the file is fetched and evaluated in place of
        // the tag's own text — mirroring how the browser treats <script src>,
        // where inline content is ignored when src is present. This is the
        // browser's stand-in for Ring's `load`: a page has no filesystem, so
        // the file arrives over HTTP instead of off a disk.
        //
        // Sequential on purpose: a file defining Greet must finish before the
        // file calling it begins, exactly as consecutive `load` lines behave.
        const tags = document.querySelectorAll('script[type="text/ring"]');
        for (let i = 0; i < tags.length; i++) {
            const src = tags[i].getAttribute("src");
            let code = tags[i].textContent;
            let where = 'inline <script type="text/ring">';
            if (src) {
                where = src;
                try {
                    const resp = await fetch(src);
                    if (!resp.ok) {
                        // The server answered, so the address is the problem.
                        throw new Error("HTTP " + resp.status + " " + resp.statusText +
                            " — check the path is right and the file sits beside your page");
                    }
                    code = await resp.text();
                } catch (e) {
                    // No response at all usually means the page was opened as
                    // file://, where fetch is blocked outright. Say so, rather
                    // than leaving the reader with a bare "Failed to fetch".
                    const blocked = /Failed to fetch|NetworkError|Load failed/i.test(e.message);
                    console.error("[ringscript] could not load " + src + ": " + e.message +
                        (blocked ? " — .ring files must be served over http:// or https://," +
                                   " not opened from file://" : ""));
                    continue;
                }
            }
            const r = ring.eval(code);
            if (!r.ok) console.error("[ringscript] " + where + ": " + r.error);
        }
        global.ring = ring;
        return ring;
    }

    // VERSION is the loader's own version; ring.version reports the version
    // of the wasm runtime it loaded (they ship together and should match).
    const RingScript = { load: load, boot: boot, VERSION: "0.9" };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = RingScript;
    }
    global.RingScript = RingScript;
})(typeof globalThis !== "undefined" ? globalThis : this);
