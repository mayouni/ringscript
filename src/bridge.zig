//! RingScript bridge — resident Ring VM for the browser (wasm32-wasi).
//!
//! Exported API (toolchain-agnostic, see REPAIR_PLAN.md §3):
//!   rs_init()          -> i32     create the resident RingState once (0 = ok)
//!   rs_reset()         -> i32     destroy + recreate (explicit, never implicit)
//!   rs_eval(code)      -> i32     run code IN the resident state; 0 = ok
//!   rs_last_output()   -> ptr     accumulated output since last eval (NUL-terminated)
//!   rs_last_error()    -> ptr     "" or "line N: message" (NUL-terminated)
//!   rs_alloc(n)/rs_free(p,n)      wasm-side buffers for passing strings from JS

const std = @import("std");

const alloc = std.heap.c_allocator;

// ---------------------------------------------------------------- Ring C API

const RingState = opaque {};
const List = opaque {};

extern fn ring_state_init() ?*RingState;
extern fn ring_state_delete(pState: ?*RingState) ?*RingState;
extern fn ring_state_runcode(pState: ?*RingState, cCode: [*:0]const u8) void;
extern fn ring_vm_funcregister2(
    pState: ?*RingState,
    cName: [*:0]const u8,
    pFunc: *const fn (?*anyopaque) callconv(.c) void,
) void;

extern fn ring_vm_api_isstring(p: ?*anyopaque, n: c_int) c_int;
extern fn ring_vm_api_getstring(p: ?*anyopaque, n: c_int) ?[*:0]u8;
extern fn ring_vm_api_getstringsize(p: ?*anyopaque, n: c_int) c_uint;
extern fn ring_vm_api_isnumber(p: ?*anyopaque, n: c_int) c_int;
extern fn ring_vm_api_getnumber(p: ?*anyopaque, n: c_int) f64;
extern fn ring_vm_api_islist(p: ?*anyopaque, n: c_int) c_int;
extern fn ring_vm_api_getlist(p: ?*anyopaque, n: c_int) ?*List;
extern fn ring_vm_api_ispointer(p: ?*anyopaque, n: c_int) c_int;
extern fn ring_vm_api_getpointer(p: ?*anyopaque, n: c_int) ?*anyopaque;

extern fn ring_vm_api_retstring2(p: ?*anyopaque, s: [*]const u8, n: c_uint) void;

/// Line number captured at error time by the RINGSCRIPT PATCH in
/// ringvm/src/vmerror.c (catch-time state restore rewinds pVM->nLineNumber,
/// so it cannot be read from the VM once the catch block runs).
extern var rs_error_line: c_uint;
extern fn rs_vm_decimals(p: ?*anyopaque) c_uint;
extern fn ring_general_numtostring(nNum: f64, cStr: [*]u8, nDecimals: c_int) [*:0]u8;

// Exact-mirror value printers implemented in wasi_stubs.c (vendor rlist.c
// semantics: byte-exact strings, objects, circular-ref guard, pointers).
extern fn rs_print_value_list(p: ?*anyopaque, pList: ?*List) void;
extern fn rs_print_pointer(p: ?*anyopaque, pValue: ?*anyopaque) void;

// ---------------------------------------------------------------- state

var g_state: ?*RingState = null;
var g_out: std.ArrayList(u8) = .empty;
var g_err: std.ArrayList(u8) = .empty;
var g_result: std.ArrayList(u8) = .empty;
var g_callcode: std.ArrayList(u8) = .empty;
var g_arg: []const u8 = "";
var g_input: std.ArrayList(u8) = .empty;
var g_input_pos: usize = 0;
var g_evalcode: std.ArrayList(u8) = .empty;
var g_eval_counter: u64 = 0;
var g_main_called: bool = false;

fn appendOut(bytes: []const u8) void {
    g_out.appendSlice(alloc, bytes) catch {};
}

/// Format a number exactly like native `see`: through the VM's own
/// ring_general_numtostring with the state's live decimals() setting.
fn appendNumber(p: ?*anyopaque, n: f64) void {
    var buf: [160]u8 = undefined; // RING_MEDIUMBUF is 128
    const s = ring_general_numtostring(n, &buf, @intCast(rs_vm_decimals(p)));
    appendOut(std.mem.span(s));
}

/// C hook the VM calls for every `see` (registered as ring_vm_see, wired to
/// the Ring-level `ringvm_see` override in rs_init). Lists, objects and
/// pointers delegate to the exact-mirror printers in wasi_stubs.c.
fn seeHook(p: ?*anyopaque) callconv(.c) void {
    if (ring_vm_api_isstring(p, 1) != 0) {
        if (ring_vm_api_getstring(p, 1)) |s| {
            const len: usize = @intCast(ring_vm_api_getstringsize(p, 1));
            appendOut(s[0..len]);
        }
    } else if (ring_vm_api_isnumber(p, 1) != 0) {
        appendNumber(p, ring_vm_api_getnumber(p, 1));
    } else if (ring_vm_api_islist(p, 1) != 0) {
        rs_print_value_list(p, ring_vm_api_getlist(p, 1));
    } else if (ring_vm_api_ispointer(p, 1) != 0) {
        rs_print_pointer(p, ring_vm_api_getpointer(p, 1));
    }
}

/// The code passed to the current rs_eval, valid for its duration; the eval
/// shim pulls it through the rs_getcode hook so no string escaping is needed.
var g_code: []const u8 = "";

/// C hook: return the pending eval code to Ring as a string.
fn getCodeHook(p: ?*anyopaque) callconv(.c) void {
    ring_vm_api_retstring2(p, g_code.ptr, @intCast(g_code.len));
}

/// C hook: the catch block reports the trapped error here. The line comes
/// from the vendor patch in vmerror.c — captured when the error fired, since
/// the catch-time VM state has already been rewound.
fn reportErrorHook(p: ?*anyopaque) callconv(.c) void {
    g_err.clearRetainingCapacity();
    var buf: [32]u8 = undefined;
    const line = std.fmt.bufPrint(&buf, "line {d}: ", .{rs_error_line}) catch "line ?: ";
    g_err.appendSlice(alloc, line) catch {};
    if (ring_vm_api_isstring(p, 1) != 0) {
        if (ring_vm_api_getstring(p, 1)) |s| {
            const len: usize = @intCast(ring_vm_api_getstringsize(p, 1));
            g_err.appendSlice(alloc, s[0..len]) catch {};
        }
    }
}

// ------------------------------------------------------------ embedded files
//
// The ringlib/ payload is baked into the wasm (REPAIR_PLAN.md §3: no browser
// filesystem at all). The C-level fopen override in wasi_stubs.c resolves
// every VM file access — `load`, fexists, read() — against this map.

const EmbeddedFile = struct { name: []const u8, data: []const u8 };

const embedded_files = [_]EmbeddedFile{
    .{ .name = "ringlib/stzZql.ring", .data = @embedFile("ringlib/stzZql.ring") },
    .{ .name = "ringlib/stzzql_smoke.ring", .data = @embedFile("ringlib/stzzql_smoke.ring") },
    .{ .name = "ringlib/json.ring", .data = @embedFile("ringlib/json.ring") },
};

fn baseName(path: []const u8) []const u8 {
    var p = path;
    if (std.mem.lastIndexOfAny(u8, p, "/\\")) |i| p = p[i + 1 ..];
    return p;
}

/// Resolve a path against the embedded map: exact (case-insensitive) match
/// first, then suffix match (load may prefix a directory), then basename
/// match (load "stzZql.ring" from inside ringlib/). Called from the fopen
/// override in wasi_stubs.c.
export fn rs_find_embedded(path: [*:0]const u8, out_len: *usize) ?[*]const u8 {
    var p = std.mem.span(path);
    while (p.len > 0 and (p[0] == '/' or p[0] == '\\')) p = p[1..];
    while (std.mem.startsWith(u8, p, "./")) p = p[2..];
    for (embedded_files) |e| {
        if (std.ascii.eqlIgnoreCase(e.name, p)) {
            out_len.* = e.data.len;
            return e.data.ptr;
        }
    }
    for (embedded_files) |e| {
        if (p.len > e.name.len and std.ascii.eqlIgnoreCase(p[p.len - e.name.len ..], e.name)) {
            out_len.* = e.data.len;
            return e.data.ptr;
        }
    }
    const base = baseName(p);
    for (embedded_files) |e| {
        if (std.ascii.eqlIgnoreCase(baseName(e.name), base)) {
            out_len.* = e.data.len;
            return e.data.ptr;
        }
    }
    return null;
}

/// C hook: return the pending rs_call JSON argument to Ring.
fn getArgHook(p: ?*anyopaque) callconv(.c) void {
    ring_vm_api_retstring2(p, g_arg.ptr, @intCast(g_arg.len));
}

/// C hook: the rs_call wrapper stores the encoded result here.
fn setResultHook(p: ?*anyopaque) callconv(.c) void {
    g_result.clearRetainingCapacity();
    if (ring_vm_api_isstring(p, 1) != 0) {
        if (ring_vm_api_getstring(p, 1)) |s| {
            const len: usize = @intCast(ring_vm_api_getstringsize(p, 1));
            g_result.appendSlice(alloc, s[0..len]) catch {};
        }
    }
}

/// JS import: dispatch a Ring jscall() to the host page. Returns a pointer
/// to a NUL-terminated reply the host allocated with rs_alloc (0 = none);
/// the hook frees it after handing the string to Ring.
extern "ringscript" fn js_dispatch(
    name_ptr: [*]const u8,
    name_len: usize,
    json_ptr: [*]const u8,
    json_len: usize,
) ?[*:0]u8;

/// C hook: Ring's jscall(cName, cJson) — the Ring→JS seam.
fn jscallHook(p: ?*anyopaque) callconv(.c) void {
    var name: []const u8 = "";
    var json: []const u8 = "";
    if (ring_vm_api_isstring(p, 1) != 0) {
        if (ring_vm_api_getstring(p, 1)) |s| name = s[0..@intCast(ring_vm_api_getstringsize(p, 1))];
    }
    if (ring_vm_api_isstring(p, 2) != 0) {
        if (ring_vm_api_getstring(p, 2)) |s| json = s[0..@intCast(ring_vm_api_getstringsize(p, 2))];
    }
    const reply = js_dispatch(name.ptr, name.len, json.ptr, json.len);
    if (reply) |r| {
        const span = std.mem.span(r);
        ring_vm_api_retstring2(p, span.ptr, @intCast(span.len));
        alloc.free(r[0 .. span.len + 1]);
    } else {
        ring_vm_api_retstring2(p, "", 0);
    }
}

/// JS import: ask the host page for one line of input, live (the loader's
/// default is window.prompt in browsers). Returns a NUL-terminated string
/// allocated with rs_alloc (freed here), or null when the host has none —
/// Node test harnesses, or the user cancelling the prompt.
extern "ringscript" fn js_give() ?[*:0]u8;

/// C hook registered AS "ringvm_give" (replacing genlib's stdin-based C
/// default): hand the next queued input line to Ring's give, echoing it to
/// the output the way a terminal would. When the queue runs dry, ask the
/// host live via js_give (interactive programs stay interactive in the
/// browser); if the host has no input either, raise a Ring error — a
/// `give` returning "" silently could spin interactive loops forever.
///
/// Deliberately a C function, not a Ring-level override: a Ring-level
/// ringvm_give corrupts later attribute-only class regions (reproduced on
/// native Ring 1.27 — the first class attribute vanishes after any give).
fn giveHook(p: ?*anyopaque) callconv(.c) void {
    const buf = g_input.items;
    if (g_input_pos >= buf.len) {
        if (js_give()) |r| {
            const span = std.mem.span(r);
            appendOut(span);
            appendOut("\n");
            ring_vm_api_retstring2(p, span.ptr, @intCast(span.len));
            alloc.free(r[0 .. span.len + 1]);
            return;
        }
        ring_vm_error(p, "Give needs input but the input is exhausted");
        return;
    }
    var end = g_input_pos;
    while (end < buf.len and buf[end] != '\n') end += 1;
    var line = buf[g_input_pos..end];
    g_input_pos = if (end < buf.len) end + 1 else buf.len;
    if (line.len > 0 and line[line.len - 1] == '\r') line = line[0 .. line.len - 1];
    appendOut(line);
    appendOut("\n");
    ring_vm_api_retstring2(p, line.ptr, @intCast(line.len));
}

extern fn ring_vm_error(pVM: ?*anyopaque, cStr: [*:0]const u8) void;

extern fn ring_vm_api_retnumber(p: ?*anyopaque, n: f64) void;
extern fn rs_vm_maincalled(p: ?*anyopaque) c_uint;

/// C hook for the auto-main pass. Returns 0 when the shim should call
/// main(), 1 when it must not: either we already ran it, or the VM's own
/// end-of-program auto-call fired inside the eval (that built-in path
/// triggers only when the eval'd code contains a class — the final return
/// stays unconverted and reaches the end-of-program handling).
fn mainFoundHook(p: ?*anyopaque) callconv(.c) void {
    if (g_main_called or rs_vm_maincalled(p) != 0) {
        g_main_called = true;
        ring_vm_api_retnumber(p, 1);
        return;
    }
    g_main_called = true;
    ring_vm_api_retnumber(p, 0);
}

const see_shim = "func ringvm_see cData ring_vm_see(cData)";
const load_json_shim = "load \"ringlib/json.ring\"";

/// Every eval runs through this wrapper: errors (compile errors surface as
/// eval() runtime errors, runtime errors unwind to the catch) land in
/// rs_reporterror and the resident state survives.
///
/// Line numbers are real, including in multi-line evals, thanks to two
/// marked vendor patches: vmeval.c keeps ICO_NEWLINE in eval'd bytecode
/// (upstream strips it) and vmerror.c captures pVM->nLineNumber into
/// rs_error_line at error time, before catch unwinding rewinds it.
const eval_shim = "try eval(rs_getcode()) catch rs_reporterror(cCatchError) done";

// ---------------------------------------------------------------- exports

export fn rs_init() i32 {
    if (g_state != null) return 0;
    const st = ring_state_init() orelse return -1;
    ring_vm_funcregister2(st, "ring_vm_see", &seeHook);
    ring_vm_funcregister2(st, "rs_getcode", &getCodeHook);
    ring_vm_funcregister2(st, "rs_reporterror", &reportErrorHook);
    ring_vm_funcregister2(st, "rs_getarg", &getArgHook);
    ring_vm_funcregister2(st, "rs_setresult", &setResultHook);
    ring_vm_funcregister2(st, "ringvm_give", &giveHook);
    ring_vm_funcregister2(st, "rs_notemain", &mainFoundHook);
    ring_vm_funcregister2(st, "jscall", &jscallHook);
    ring_state_runcode(st, see_shim);
    ring_state_runcode(st, load_json_shim);
    g_state = st;
    return 0;
}

export fn rs_reset() i32 {
    if (g_state) |st| {
        _ = ring_state_delete(st);
        g_state = null;
    }
    g_main_called = false;
    return rs_init();
}

/// Auto-main pass: if the eval defined main() and it never ran, call it —
/// matching native Ring, which invokes a defined main() once after the
/// top-level statements (vmfuncs.c end-of-program path, unreachable in eval).
const call_main_shim = "if isfunction(\"main\") and rs_notemain() = 0 main() ok";

export fn rs_eval(code: [*:0]const u8) i32 {
    if (g_state == null and rs_init() != 0) return -1;
    g_out.clearRetainingCapacity();
    g_err.clearRetainingCapacity();

    // Append a uniquely-named terminator CLASS. If the code ends inside a
    // class region (e.g. `class point x y z` with no methods), the region
    // would otherwise be closed by eval's return-from-eval instruction and
    // `new` on that class silently aborts the eval mid-statement. A trailing
    // declaration delimits the region the way the next one would in a file.
    // A class (not a func) on purpose: a trailing func would JOIN the user's
    // last class as a method and can change semantics (e.g. it breaks
    // inherited-method resolution after mergemethods() — reproduced on
    // native); the terminator class's own region is never executed because
    // nothing instantiates it.
    g_eval_counter += 1;
    g_evalcode.clearRetainingCapacity();
    g_evalcode.appendSlice(alloc, std.mem.span(code)) catch return -1;
    var buf: [48]u8 = undefined;
    const term = std.fmt.bufPrint(&buf, "\nclass __rs_end_{d}", .{g_eval_counter}) catch return -1;
    g_evalcode.appendSlice(alloc, term) catch return -1;

    g_code = g_evalcode.items;
    defer g_code = "";
    ring_state_runcode(g_state, eval_shim);
    if (g_err.items.len != 0) return 1;

    if (!g_main_called) {
        g_code = call_main_shim;
        ring_state_runcode(g_state, eval_shim);
        if (g_err.items.len != 0) return 1;
    }
    return 0;
}

/// Call a Ring function with one JSON argument; returns its result as a
/// NUL-terminated JSON string ("" + rs_last_error set on failure).
/// Runtime-mode counterpart of rs_eval (REPAIR_PLAN.md §3).
export fn rs_call(fname: [*:0]const u8, json: [*:0]const u8) [*:0]const u8 {
    if (g_state == null and rs_init() != 0) return "";
    g_out.clearRetainingCapacity();
    g_err.clearRetainingCapacity();
    g_result.clearRetainingCapacity();

    const name = std.mem.span(fname);
    if (name.len == 0) {
        g_err.appendSlice(alloc, "rs_call: empty function name") catch {};
        return "";
    }
    for (name) |ch| {
        if (!std.ascii.isAlphanumeric(ch) and ch != '_') {
            g_err.appendSlice(alloc, "rs_call: invalid function name") catch {};
            return "";
        }
    }

    g_arg = std.mem.span(json);
    defer g_arg = "";
    g_callcode.clearRetainingCapacity();
    g_callcode.appendSlice(alloc, "rs_setresult(JsonEncode(") catch return "";
    g_callcode.appendSlice(alloc, name) catch return "";
    g_callcode.appendSlice(alloc, "(JsonDecode(rs_getarg()))))") catch return "";
    g_code = g_callcode.items;
    defer g_code = "";
    ring_state_runcode(g_state, eval_shim);
    if (g_err.items.len != 0) return "";

    g_result.append(alloc, 0) catch return "";
    defer _ = g_result.pop();
    return @ptrCast(g_result.items.ptr);
}

export fn rs_last_output() [*:0]const u8 {
    g_out.append(alloc, 0) catch return "";
    defer _ = g_out.pop();
    return @ptrCast(g_out.items.ptr);
}

/// Byte length of the last output — read this many bytes from
/// rs_last_output()'s pointer for binary-safe output (Ring strings may
/// legitimately contain NUL bytes, e.g. from int2bytes()).
export fn rs_last_output_size() usize {
    return g_out.items.len;
}

export fn rs_last_error() [*:0]const u8 {
    g_err.append(alloc, 0) catch return "";
    defer _ = g_err.pop();
    return @ptrCast(g_err.items.ptr);
}

/// Queue input for `give`: the whole text is split into lines as `give`
/// consumes it. Replaces any previous queue. Pass "" to clear.
export fn rs_set_input(text: [*:0]const u8) void {
    g_input.clearRetainingCapacity();
    g_input.appendSlice(alloc, std.mem.span(text)) catch {};
    g_input_pos = 0;
}

/// Append raw bytes to the eval output buffer. The JS WASI shim calls this
/// from fd_write (when stdout capture is on) so C-level output — print(),
/// puts(), VM error prints — lands in rs_last_output() in true order
/// relative to see-hook output.
export fn rs_append_output(ptr: [*]const u8, len: usize) void {
    appendOut(ptr[0..len]);
}

export fn rs_alloc(n: usize) ?[*]u8 {
    const mem = alloc.alloc(u8, n) catch return null;
    return mem.ptr;
}

export fn rs_free(p: [*]u8, n: usize) void {
    alloc.free(p[0..n]);
}
