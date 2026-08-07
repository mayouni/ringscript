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
                //
                // REALTIME is shifted by the local timezone offset on purpose.
                // wasi-libc ships no timezone database, so the VM's localtime()
                // leaves UTC untouched — time() would read an hour or more off
                // the clock on the user's wall, which is not what `time()`
                // means to anyone writing Ring. Recomputed per call so a
                // daylight-saving change mid-session is picked up.
                const ms = clockId === 0
                    ? Date.now() - new Date().getTimezoneOffset() * 60000
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

    /*
    ** The compiled Module cache behind load(). Keyed by identity — the URL
    ** string, or the buffer object itself — and it stores the PROMISE, so
    ** two loads racing on the same source share one compile instead of
    ** starting two. A failed compile removes itself from the cache: a
    ** network hiccup must not poison every later attempt at the same URL.
    **
    ** Identity keying is deliberate. Hashing 371 KB to key by content would
    ** cost a chunk of what the cache saves, and the identity story is
    ** sound: a URL's bytes do not change within a page's lifetime (a
    ** reload clears the cache), and a buffer object IS its bytes. Callers
    ** that slice a fresh buffer per load simply miss the cache and get
    ** today's behavior.
    */
    const moduleByUrl = new Map();
    const moduleByBuffer = typeof WeakMap !== "undefined" ? new WeakMap() : null;

    /*
    ** Post-init memory snapshots, one per compiled Module. Measured on the
    ** shipped build: instantiating a cached Module costs 0.06 ms, but
    ** _initialize + rs_init cost ~5.5 ms — libc constructors, building the
    ** RingState, parsing the embedded ringlib. All of that work writes
    ** nothing but linear memory (the C hook pointers rs_init registers are
    ** function-table indices, identical in every instance of the same
    ** Module), so the FIRST instance donates a copy of its just-initialized
    ** memory and every later instance is stamped from it: grow, memcpy,
    ** done — ~1 ms instead of ~5.5.
    **
    ** Verified equivalent before shipping: a stamped VM has no leftover
    ** state, classes and errors behave, embedded loads resolve, and the
    ** unseeded random() sequence is byte-identical to a fresh init's —
    ** the whole battery runs on stamped instances by construction.
    **
    ** The price is one extra instance-worth of RAM (~21 MB) held per cached
    ** Module for the page's lifetime. opts.snapshot === false opts out of
    ** both donating and receiving.
    */
    const snapshotByModule = typeof WeakMap !== "undefined" ? new WeakMap() : null;

    function compileSource(source) {
        const isBuf = source instanceof ArrayBuffer ||
            (typeof Buffer !== "undefined" && Buffer.isBuffer && Buffer.isBuffer(source)) ||
            (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(source));
        if (isBuf) {
            let p = moduleByBuffer && moduleByBuffer.get(source);
            if (!p) {
                p = WebAssembly.compile(source);
                if (moduleByBuffer) moduleByBuffer.set(source, p);
            }
            return p;
        }
        if (typeof fetch !== "function") {
            return Promise.reject(new Error("RingScript.load: pass an ArrayBuffer in this environment"));
        }
        let p = moduleByUrl.get(source);
        if (!p) {
            p = (async function () {
                const resp = await fetch(source);
                if (WebAssembly.compileStreaming) {
                    try {
                        return await WebAssembly.compileStreaming(resp);
                    } catch (e) {
                        // Server sent a non-wasm MIME type; refetch and compile from bytes.
                        const resp2 = await fetch(source);
                        return await WebAssembly.compile(await resp2.arrayBuffer());
                    }
                }
                return WebAssembly.compile(await resp.arrayBuffer());
            })();
            moduleByUrl.set(source, p);
            p.catch(function () { moduleByUrl.delete(source); });
        }
        return p;
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

        /// Same guards as allocBytes, for the two callbacks wasm invokes
        /// before the `ex` alias exists. Never throws: wasm is on the stack.
        function allocReply(bytes) {
            const need = bytes.length + 1;
            if (need > 0xffffffff) return null;
            let raw;
            try { raw = exports.rs_alloc(need); } catch (e) { return null; }  // the allocator trapped
            // A wasm pointer is an i32, so anything above 2 GB arrives here as
            // a NEGATIVE number. Read it unsigned before doing any arithmetic
            // with it, or the bounds test below passes trivially and set()
            // throws RangeError — which is exactly how this used to kill the
            // page.
            const ptr = raw >>> 0;
            if (ptr === 0) return null;
            const mem = new Uint8Array(memory.buffer);    // may have just grown
            if (ptr + need > mem.length) {                // no room, or wrapped
                try { exports.rs_free(ptr, need); } catch (e) { /* nothing left to do */ }
                return null;
            }
            mem.set(bytes, ptr);
            mem[ptr + bytes.length] = 0;
            return ptr;
        }

        // Ring -> JS seam: Ring's jscall(name, json) lands here. Handlers are
        // registered with api.on(name, fn); unhandled calls fall through to a
        // DOM CustomEvent "ringscript:<name>" in browsers. A handler's return
        // value (JSON-serializable) is passed back to Ring.
        const handlers = Object.create(null);
        function js_dispatch(namePtr, nameLen, jsonPtr, jsonLen) {
            const mem = new Uint8Array(memory.buffer);
            // Unsigned: past 2 GB these i32 pointers arrive negative, and
            // subarray would silently read from the wrong place.
            const np = namePtr >>> 0, nl = nameLen >>> 0;
            const jp = jsonPtr >>> 0, jl = jsonLen >>> 0;
            const name = decoder.decode(mem.subarray(np, np + nl));
            const raw = decoder.decode(mem.subarray(jp, jp + jl));
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
            // Called from inside wasm: returning 0 means "no reply", which
            // Ring handles. Throwing here would unwind through the VM.
            const ptr = allocReply(bytes);
            return ptr === null ? 0 : ptr;
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
            const ptr = allocReply(bytes);
            return ptr === null ? 0 : ptr;
        }

        const imports = {
            wasi_snapshot_preview1: wasi,
            ringscript: { js_dispatch: js_dispatch, js_give: js_give },
        };

        // Compile once, instantiate per instance. Compiling 371 KB of wasm
        // costs milliseconds; instantiating an already-compiled Module costs
        // microseconds — and this loader used to recompile for EVERY
        // instance, which the rivals harness measured as the whole
        // fresh-evaluator gap against Lua and QuickJS (6.7 ms vs 0.15 ms;
        // the Playground creates a fresh instance per run). See
        // docs/HEADROOM_PLAN.md P1.
        const wasmModule = await compileSource(source);
        const instance = await WebAssembly.instantiate(wasmModule, imports);
        const snapshot = (opts.snapshot === false || !snapshotByModule)
            ? null : snapshotByModule.get(wasmModule);
        const ex = instance.exports;
        exports = ex;
        memory = ex.memory;

        if (snapshot) {
            // Stamp the donated post-init memory instead of running the
            // constructors and rs_init again; both already ran in the donor
            // and wrote nothing outside this memory.
            const nowBytes = ex.memory.buffer.byteLength;
            if (snapshot.length > nowBytes) {
                ex.memory.grow((snapshot.length - nowBytes) / 65536);
            }
            new Uint8Array(ex.memory.buffer).set(snapshot);
        } else if (typeof ex._initialize === "function") {
            // WASI reactor model: run C runtime constructors once.
            ex._initialize();
        }

        function readCString(rawPtr) {
            // Unsigned: a wasm i32 pointer past 2 GB arrives negative, and
            // reading from a negative index silently yields undefined — which
            // ends the scan instantly and returns garbage.
            const ptr = rawPtr >>> 0;
            if (ptr === 0) return "";
            const mem = new Uint8Array(memory.buffer);
            let end = ptr;
            while (end < mem.length && mem[end] !== 0) end++;
            return decoder.decode(mem.subarray(ptr, end));
        }

        // Binary-safe: Ring output may contain NUL bytes (e.g. int2bytes),
        // so read the exact byte length instead of stopping at NUL.
        function readOutput() {
            const len = ex.rs_last_output_size() >>> 0;
            if (!len) return "";
            const ptr = ex.rs_last_output() >>> 0;      // unsigned, see readCString
            const mem = new Uint8Array(memory.buffer);
            if (ptr === 0 || ptr + len > mem.length) return "";
            return decoder.decode(mem.subarray(ptr, ptr + len));
        }

        /*
        ** Allocating into wasm memory has three ways to fail, and all of them
        ** used to end as a raw RangeError from set() — which kills the page,
        ** the one thing this runtime promises never to do.
        **
        **   1. rs_alloc returns 0            — the allocator refused.
        **   2. rs_alloc traps                — Zig's allocator hit an
        **      unreachable; the call throws RuntimeError.
        **   3. rs_alloc "succeeds" out of bounds — the length crosses the
        **      wasm32 pointer width and wraps, so the returned block is far
        **      smaller than asked for. Writing the full length then runs off
        **      the end of memory.
        **
        ** allocBytes handles all three and reports failure as null, so the
        ** caller decides what to do rather than the page dying.
        */
        function allocBytes(bytes) {
            const need = bytes.length + 1;
            if (need > 0xffffffff) return null;          // cannot survive the ABI
            let raw;
            try { raw = ex.rs_alloc(need); } catch (e) { return null; }  // the allocator trapped
            // A wasm pointer is an i32, so anything above 2 GB arrives here as
            // a NEGATIVE number. Read it unsigned before doing any arithmetic
            // with it, or the bounds test below passes trivially and set()
            // throws RangeError — which is exactly how this used to kill the
            // page.
            const ptr = raw >>> 0;
            if (ptr === 0) return null;
            const mem = new Uint8Array(memory.buffer);    // may have just grown
            if (ptr + need > mem.length) {                // no room, or wrapped
                try { ex.rs_free(ptr, need); } catch (e) { /* nothing left to do */ }
                return null;
            }
            mem.set(bytes, ptr);
            mem[ptr + bytes.length] = 0;
            return ptr;
        }

        /// Raised when wasm memory cannot take the value. Typed so eval/call
        /// can turn it into an ordinary failed result instead of an exception.
        function OutOfMemory(bytes) {
            // Wasm linear memory never shrinks, so a genuinely exhausted
            // instance cannot be rescued from inside — not even by reset(),
            // which needs to allocate a new state. Say so, rather than
            // sending the caller round a loop that cannot succeed.
            const e = new Error("RingScript: out of memory writing " + bytes +
                " bytes into the VM. The page is intact. Try ring.reset(); if " +
                "that also fails, this VM instance is exhausted and a fresh " +
                "one must be loaded (reload the page).");
            e.name = "RingScriptOutOfMemory";
            return e;
        }

        function withCString(str, fn) {
            const data = encoder.encode(str);
            const ptr = allocBytes(data);
            if (ptr === null) throw OutOfMemory(data.length + 1);
            try {
                return fn(ptr);
            } finally {
                ex.rs_free(ptr, data.length + 1);
            }
        }

        // The VM is one resident state: it cannot run inside itself. The
        // reachable way to try is a jscall or onGive handler calling Ring
        // back while Ring is still running — and before this guard that
        // silently discarded the rest of the outer program, swapped its
        // output and its error for the inner one's, and gave rs_call the
        // wrong return value, all while reporting success.
        //
        // Checked before entering wasm, so a refused call disturbs no runtime
        // state at all and the run already in progress finishes normally.
        // Cleared in a `finally` after every top-level entry: a wasm trap
        // unwinds out of rs_eval without running its defer, and a guard left
        // standing would refuse every later eval for the life of the page.
        function endRun() {
            try { if (ex.rs_end_run) ex.rs_end_run(); } catch (e) { /* nothing left to clear */ }
        }

        function reentryError(what) {
            return "RingScript: the VM is already running, so this " + what +
                " was refused (it would have discarded the rest of the " +
                "program already in progress). A jscall or onGive handler " +
                "cannot call Ring back while Ring is still running — " +
                "return from the handler first, e.g. " +
                "queueMicrotask(function () { ring.call(...) }).";
        }

        const api = {
            instance: instance,
            /// RingScript's version, read from the wasm actually loaded.
            version: ex.rs_version ? readCString(ex.rs_version()) : "unknown",
            init() { return ex.rs_init(); },
            /// Recreate the VM. Never throws: this is the recovery path, so
            /// it must survive the very conditions people reach for it in —
            /// an exhausted heap can make rs_reset itself trap. Returns 0 on
            /// success, nonzero if the runtime is beyond saving and the page
            /// should be reloaded.
            reset() {
                // Not from inside a handler: rs_reset deletes the state the
                // running VM is standing on. The bridge refuses too (-3).
                if (ex.rs_busy && ex.rs_busy() !== 0) return -3;
                try {
                    return ex.rs_reset();
                } catch (e) {
                    return -1;
                }
            },
            /// True while an eval or call is inside the VM. A jscall/onGive
            /// handler can ask this to find out why it must defer.
            busy() { return !!(ex.rs_busy && ex.rs_busy() !== 0); },
            /// eval(code[, input]) — `input` is the text queue served to
            /// Ring's `give`, line by line. Each eval starts with a fresh
            /// queue (empty when the argument is omitted). CRLF is
            /// normalized to LF, matching native Ring's text-mode reads.
            eval(code, input) {
                if (ex.rs_busy && ex.rs_busy() !== 0) {
                    return { ok: false, code: -3, output: "", error: reentryError("evaluation") };
                }
                try {
                    withCString((input || "").replace(/\r\n/g, "\n"), function (ptr) { ex.rs_set_input(ptr); });
                    const rc = withCString(String(code).replace(/\r\n/g, "\n"), function (ptr) { return ex.rs_eval(ptr); });
                    return {
                        ok: rc === 0,
                        code: rc,
                        output: readOutput(),
                        error: readCString(ex.rs_last_error()),
                    };
                } catch (e) {
                    // eval() returns a result. Always. In a page an escaping
                    // exception is a dead page, and "your Ring was bad" must
                    // never mean that — so every way the VM can fail comes
                    // back in the same shape as a Ring error:
                    //
                    //   out of memory        — the heap ceiling
                    //   RangeError          — wasm stack exhausted, e.g. by
                    //                         deeply nested brackets, which
                    //                         the parser recurses through
                    //   RuntimeError        — a wasm trap
                    //
                    // The original name and message are kept so the cause is
                    // still diagnosable from the returned error.
                    return {
                        ok: false,
                        code: -2,
                        output: "",
                        error: e && e.name === "RingScriptOutOfMemory"
                            ? e.message
                            : "RingScript: the VM could not complete this evaluation (" +
                              ((e && e.name) || "Error") + ": " +
                              ((e && e.message) || String(e)) +
                              "). The page is intact; call ring.reset() if the VM " +
                              "misbehaves afterwards.",
                    };
                } finally {
                    endRun();
                }
            },
            lastOutput() { return readOutput(); },
            lastError() { return readCString(ex.rs_last_error()); },
            /// Call a Ring function with one JSON-serializable argument;
            /// returns { ok, result (parsed), output, error }.
            call(fname, arg) {
                if (ex.rs_busy && ex.rs_busy() !== 0) {
                    return { ok: false, result: null, output: "", error: reentryError("call") };
                }
                const json = JSON.stringify(arg === undefined ? null : arg);
                let resPtr;
                try {
                    resPtr = withCString(fname, function (fp) {
                        return withCString(json, function (jp) {
                            return ex.rs_call(fp, jp);
                        });
                    });
                } catch (e) {
                    // Same contract as eval(): every failure is a result, not
                    // an exception that takes the page with it.
                    return {
                        ok: false,
                        result: null,
                        output: "",
                        error: e && e.name === "RingScriptOutOfMemory"
                            ? e.message
                            : "RingScript: the VM could not complete this call (" +
                              ((e && e.name) || "Error") + ": " +
                              ((e && e.message) || String(e)) + ").",
                    };
                } finally {
                    endRun();
                }
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

        if (!snapshot) {
            const rc = api.init();
            if (rc !== 0) throw new Error("RingScript: rs_init failed (" + rc + ")");
            // This instance becomes the donor: its memory right now is
            // exactly "a freshly initialized VM", captured before any user
            // code could make it anything else.
            if (opts.snapshot !== false && snapshotByModule && !snapshotByModule.get(wasmModule)) {
                snapshotByModule.set(wasmModule, new Uint8Array(ex.memory.buffer).slice());
            }
        }
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
    ** The DOM seam, callable from Ring via Page(name, data):
    **   Page("settext",  [ :id = "x", :text = v ])   set an element's text
    **   Page("gettext",  [ :id = "x" ])              read an element's text
    **   Page("getvalue", [ :id = "x" ])              read an input's value
    ** Anything else: register your own with ring.on(name, fn).
    **
    ** Ring also has Platform(name, data) — the same seam, reserved for
    ** capabilities of the deployment target (storage, notifications, exit)
    ** rather than this document. That is Softanza's distinction, and
    ** StzWeb's stz.platform contract; keeping it visible in Ring source
    ** says whether a call is web-only or portable.
    **
    ** Note: functions invoked with ring.call receive exactly one argument
    ** (the JSON payload, NULL when omitted) — declare them as `func F aArg`.
    */
    /**
     * Fetch one .ring file. Never rejects — a failed file must not take the
     * rest of the page with it, exactly as a failed <script src> does not.
     * Returns { code } or { error }.
     */
    async function fetchRingFile(src) {
        try {
            const resp = await fetch(src);
            if (!resp.ok) {
                // The server answered, so the address is the problem.
                return { error: "HTTP " + resp.status + " " + resp.statusText +
                    " — check the path is right and the file sits beside your page" };
            }
            const code = await resp.text();
            // A server that rewrites unknown paths to index.html — the usual
            // single-page-app fallback — answers 200 with HTML, and Ring then
            // reports a syntax error on line 1 that tells the reader nothing.
            const ctype = resp.headers.get("content-type") || "";
            if (/text\/html/i.test(ctype) || /^\s*(<!doctype html|<html[\s>])/i.test(code.slice(0, 200))) {
                return { error: "the server returned HTML, not Ring — the path is " +
                    "probably wrong and your server answered with a page (a 404 page, " +
                    "or a single-page-app fallback) instead of the file" };
            }
            return { code: code };
        } catch (e) {
            // No response at all usually means the page was opened as file://,
            // where fetch is blocked outright. Say so, rather than leaving the
            // reader with a bare "Failed to fetch".
            const blocked = /Failed to fetch|NetworkError|Load failed/i.test(e.message);
            return { error: e.message + (blocked
                ? " — .ring files must be served over http:// or https://, not opened from file://"
                : "") };
        }
    }

    /**
     * Stands in for `ring` while the runtime is still loading.
     *
     * The starter kit and the docs both teach
     * `<button onclick="ring.call('Greet')">`, so a click during startup is
     * the taught pattern, not an edge case — and it used to die with
     * "ReferenceError: ring is not defined", leaving a dead button and a
     * cryptic console entry.
     *
     * It warns as well as returning a result: a quiet error object nobody
     * reads would trade a cryptic failure for an invisible one, and a button
     * that does nothing without saying why is the harder bug.
     */
    function bootPlaceholder(reason) {
        const say = function (what) {
            const msg = "RingScript: " + reason + ", so this " + what + " did nothing.";
            if (typeof console !== "undefined") console.warn("[ringscript] " + msg);
            return msg;
        };
        return {
            booting: true,
            eval: function () { return { ok: false, code: -4, output: "", error: say("evaluation") }; },
            call: function () { return { ok: false, result: null, output: "", error: say("call") }; },
            busy: function () { return true; },
            reset: function () { say("reset"); return -4; },
            on: function () { say("handler registration"); },
            lastOutput: function () { return ""; },
            lastError: function () { return ""; },
        };
    }

    async function boot(opts) {
        opts = opts || {};

        // Answer from the first instant, before the wasm has even been
        // fetched. Replaced by the real API as soon as the VM exists.
        const placeholder = bootPlaceholder("the runtime is still starting");
        if (typeof global.ring === "undefined") global.ring = placeholder;

        // Wait for the parser before looking for tags. boot() is normally
        // called from a <script> in <head>, and until now it only found the
        // page's Ring blocks because awaiting the wasm happened to give the
        // parser enough time — a race that a warm cache or a large document
        // could lose, silently running nothing at all.
        if (typeof document !== "undefined" && document.readyState === "loading") {
            await new Promise(function (done) {
                document.addEventListener("DOMContentLoaded", done, { once: true });
            });
        }

        // Start every download now, before the wasm is even awaited. The files
        // depend on each other to RUN in order, not to ARRIVE in order, and
        // fetching them one at a time cost a full round trip each: twelve
        // files took 2,160 ms against 251 ms for the same code inline — and
        // that was over localhost, where a round trip is nearly free.
        const tags = document.querySelectorAll('script[type="text/ring"]');
        const pending = [];
        for (let i = 0; i < tags.length; i++) {
            const src = tags[i].getAttribute("src");
            pending.push(src
                ? { where: src, result: fetchRingFile(src) }
                : { where: 'inline <script type="text/ring">',
                    result: Promise.resolve({ code: tags[i].textContent }) });
        }

        let ring;
        try {
            ring = await load(opts.wasm || "ringscript.wasm", opts);
        } catch (e) {
            // Leaving "still starting" in place would be a lie the page
            // repeats forever, so say what actually happened instead.
            if (global.ring === placeholder) {
                global.ring = bootPlaceholder("the runtime failed to load (" + e.message + ")");
            }
            throw e;
        }
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
        // Published before the blocks run, not after. Page controls are wired
        // as onclick="ring.call('Save')", and until now `ring` did not exist
        // until every file had downloaded AND run — so a click during loading
        // died with "ReferenceError: ring is not defined" and the button
        // simply did nothing. The VM is real from here on, so an early click
        // gets an ordinary Ring error naming the function it could not find,
        // which is a message someone can act on.
        global.ring = ring;

        // Run them in document order, each finishing before the next starts:
        // a file defining Greet must complete before the file calling it
        // begins, exactly as consecutive `load` lines behave. Only the
        // downloading was made parallel; the running is still sequential.
        //
        // A file that failed to arrive is skipped and the page carries on,
        // which is what the browser does with a broken <script src> — and the
        // first error logged is the real one, so read upwards.
        for (let i = 0; i < pending.length; i++) {
            const got = await pending[i].result;
            if (got.error) {
                console.error("[ringscript] could not load " + pending[i].where + ": " + got.error);
                continue;
            }
            const r = ring.eval(got.code);
            if (!r.ok) console.error("[ringscript] " + pending[i].where + ": " + r.error);
        }
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
