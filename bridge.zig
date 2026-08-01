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

extern fn ring_vm_api_retstring2(p: ?*anyopaque, s: [*]const u8, n: c_uint) void;

// getsize/getstring/getdouble are macros in rlist.h — wrapped in wasi_stubs.c,
// as is the VM line-number accessor.
extern fn rs_list_getsize(pList: ?*List) c_uint;
extern fn rs_list_getstring(pList: ?*List, n: c_uint) ?[*:0]u8;
extern fn rs_list_getdouble(pList: ?*List, n: c_uint) f64;
extern fn rs_vm_line(p: ?*anyopaque) c_uint;
extern fn ring_list_isstring(pList: ?*List, n: c_uint) c_uint;
extern fn ring_list_isnumber(pList: ?*List, n: c_uint) c_uint;
extern fn ring_list_islist(pList: ?*List, n: c_uint) c_uint;
extern fn ring_list_getlist(pList: ?*List, n: c_uint) ?*List;

// ---------------------------------------------------------------- state

var g_state: ?*RingState = null;
var g_out: std.ArrayList(u8) = .empty;
var g_err: std.ArrayList(u8) = .empty;

fn appendOut(bytes: []const u8) void {
    g_out.appendSlice(alloc, bytes) catch {};
}

fn appendNumber(n: f64) void {
    var buf: [64]u8 = undefined;
    const int: i64 = @intFromFloat(if (n >= -9007199254740992.0 and n <= 9007199254740992.0) n else 0);
    const s = if (n == @as(f64, @floatFromInt(int)))
        std.fmt.bufPrint(&buf, "{d}", .{int}) catch return
    else
        std.fmt.bufPrint(&buf, "{d}", .{n}) catch return;
    appendOut(s);
}

fn serializeList(list: ?*List) void {
    const pList = list orelse return;
    const size = rs_list_getsize(pList);
    var i: c_uint = 1;
    while (i <= size) : (i += 1) {
        if (ring_list_isstring(pList, i) != 0) {
            if (rs_list_getstring(pList, i)) |s| appendOut(std.mem.span(s));
            appendOut("\n");
        } else if (ring_list_isnumber(pList, i) != 0) {
            appendNumber(rs_list_getdouble(pList, i));
            appendOut("\n");
        } else if (ring_list_islist(pList, i) != 0) {
            serializeList(ring_list_getlist(pList, i));
        }
    }
}

/// C hook the VM calls for every `see` (registered as ring_vm_see, wired to
/// the Ring-level `ringvm_see` override in rs_init).
fn seeHook(p: ?*anyopaque) callconv(.c) void {
    if (ring_vm_api_isstring(p, 1) != 0) {
        if (ring_vm_api_getstring(p, 1)) |s| {
            const len: usize = @intCast(ring_vm_api_getstringsize(p, 1));
            appendOut(s[0..len]);
        }
    } else if (ring_vm_api_isnumber(p, 1) != 0) {
        appendNumber(ring_vm_api_getnumber(p, 1));
    } else if (ring_vm_api_islist(p, 1) != 0) {
        serializeList(ring_vm_api_getlist(p, 1));
    } else if (ring_vm_api_ispointer(p, 1) != 0) {
        appendOut("[Object]");
    }
}

/// The code passed to the current rs_eval, valid for its duration; the eval
/// shim pulls it through the rs_getcode hook so no string escaping is needed.
var g_code: []const u8 = "";

/// C hook: return the pending eval code to Ring as a string.
fn getCodeHook(p: ?*anyopaque) callconv(.c) void {
    ring_vm_api_retstring2(p, g_code.ptr, @intCast(g_code.len));
}

/// C hook: the catch block reports the trapped error here.
fn reportErrorHook(p: ?*anyopaque) callconv(.c) void {
    g_err.clearRetainingCapacity();
    var buf: [32]u8 = undefined;
    const line = std.fmt.bufPrint(&buf, "line {d}: ", .{rs_vm_line(p)}) catch "line ?: ";
    g_err.appendSlice(alloc, line) catch {};
    if (ring_vm_api_isstring(p, 1) != 0) {
        if (ring_vm_api_getstring(p, 1)) |s| {
            const len: usize = @intCast(ring_vm_api_getstringsize(p, 1));
            g_err.appendSlice(alloc, s[0..len]) catch {};
        }
    }
}

const see_shim = "func ringvm_see cData ring_vm_see(cData)";

/// Every eval runs through this wrapper: errors (compile errors surface as
/// eval() runtime errors, runtime errors unwind to the catch) land in
/// rs_reporterror and the resident state survives.
///
/// Known limitation: Ring's eval() compiles with lNoLineNumber=1 (vmeval.c)
/// and ring_vm_catch restores VM state, so the reported line is the line at
/// try-entry — accurate for single-line snippets, always "1" for multi-line
/// code. Real line fidelity needs a small vendor patch (vmeval.c:123 +
/// capturing the line in ring_vm_error before catch) — deferred.
const eval_shim = "try eval(rs_getcode()) catch rs_reporterror(cCatchError) done";

// ---------------------------------------------------------------- exports

export fn rs_init() i32 {
    if (g_state != null) return 0;
    const st = ring_state_init() orelse return -1;
    ring_vm_funcregister2(st, "ring_vm_see", &seeHook);
    ring_vm_funcregister2(st, "rs_getcode", &getCodeHook);
    ring_vm_funcregister2(st, "rs_reporterror", &reportErrorHook);
    ring_state_runcode(st, see_shim);
    g_state = st;
    return 0;
}

export fn rs_reset() i32 {
    if (g_state) |st| {
        _ = ring_state_delete(st);
        g_state = null;
    }
    return rs_init();
}

export fn rs_eval(code: [*:0]const u8) i32 {
    if (g_state == null and rs_init() != 0) return -1;
    g_out.clearRetainingCapacity();
    g_err.clearRetainingCapacity();
    g_code = std.mem.span(code);
    defer g_code = "";
    ring_state_runcode(g_state, eval_shim);
    return if (g_err.items.len == 0) 0 else 1;
}

export fn rs_last_output() [*:0]const u8 {
    g_out.append(alloc, 0) catch return "";
    defer _ = g_out.pop();
    return @ptrCast(g_out.items.ptr);
}

export fn rs_last_error() [*:0]const u8 {
    g_err.append(alloc, 0) catch return "";
    defer _ = g_err.pop();
    return @ptrCast(g_err.items.ptr);
}

export fn rs_alloc(n: usize) ?[*]u8 {
    const mem = alloc.alloc(u8, n) catch return null;
    return mem.ptr;
}

export fn rs_free(p: [*]u8, n: usize) void {
    alloc.free(p[0..n]);
}
