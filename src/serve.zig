// ==========================================================================
// RingScript dev server — `zig build serve`
// ==========================================================================
// Minimal static file server over std.net (no dependencies): serves the
// playground/ folder so the wasm module loads over HTTP the way browsers require.
// HTTP/1.0-style: one request per connection, then close. Serves .wasm with
// the correct MIME type so WebAssembly.instantiateStreaming works.
//
// Usage: ringscript-serve [port] [root]     (default 8377, root ./playground)
//        the root lets the same binary preview a scaffolded site:
//        ringscript-serve 8080 mysite
// ==========================================================================

const std = @import("std");

/// Folder served, relative to the working directory. Set from argv.
var g_root: []const u8 = "playground";

/// Serve `root` on `port` until interrupted. The CLI owns argument parsing;
/// this owns the server, so `ringscript serve` and the legacy positional
/// form reach exactly the same code.
pub fn run(port: u16, root: []const u8) !void {
    g_root = root;

    const address = try std.net.Address.parseIp4("127.0.0.1", port);
    var server = try address.listen(.{ .reuse_address = true });
    defer server.deinit();

    std.debug.print(
        \\
        \\  RingScript dev server
        \\  ---------------------
        \\  Serving : {s}/
        \\  Open    : http://localhost:{d}/
        \\
        \\  Ctrl+C to stop
        \\
        \\
    , .{ g_root, port });

    // One thread per connection. Browsers open speculative connections that
    // send nothing (preconnect); a single-threaded blocking recv on one of
    // those would wedge the whole server and the page would never load.
    while (true) {
        const conn = server.accept() catch continue;
        const t = std.Thread.spawn(.{}, handleConn, .{conn}) catch {
            conn.stream.close();
            continue;
        };
        t.detach();
    }
}

fn handleConn(conn: std.net.Server.Connection) void {
    handle(std.heap.page_allocator, conn) catch {};
}

fn handle(allocator: std.mem.Allocator, conn: std.net.Server.Connection) !void {
    defer conn.stream.close();
    var buf: [8192]u8 = undefined;
    // std.posix.recv/send, not Stream.read/writeAll: on Windows, ReadFile
    // on a socket handle fails with ERROR_INVALID_PARAMETER.
    const n = std.posix.recv(conn.stream.handle, &buf, 0) catch return;
    if (n == 0) return;
    const req = buf[0..n];

    if (!std.mem.startsWith(u8, req, "GET ")) {
        try respond(conn, "405 Method Not Allowed", "text/plain", "GET only");
        return;
    }
    const rest = req[4..];
    const sp = std.mem.indexOfScalar(u8, rest, ' ') orelse return;
    var path = rest[0..sp];
    if (std.mem.indexOfScalar(u8, path, '?')) |q| path = path[0..q];

    // no traversal
    if (std.mem.indexOf(u8, path, "..") != null) {
        try respond(conn, "403 Forbidden", "text/plain", "path traversal refused");
        return;
    }

    var path_buf: [1024]u8 = undefined;
    var eff_path: []const u8 = path;
    if (std.mem.eql(u8, path, "/") or path.len == 0) {
        eff_path = "/index.html";
    } else if (path[path.len - 1] == '/') {
        eff_path = std.fmt.bufPrint(&path_buf, "{s}index.html", .{path}) catch path;
    }

    const full = std.fs.path.join(allocator, &.{ g_root, eff_path[1..] }) catch return;
    defer allocator.free(full);

    const body = std.fs.cwd().readFileAlloc(allocator, full, 64 * 1024 * 1024) catch {
        try respond(conn, "404 Not Found", "text/plain", "not found");
        return;
    };
    defer allocator.free(body);
    try respond(conn, "200 OK", mimeFor(eff_path), body);
}

fn respond(conn: std.net.Server.Connection, status: []const u8, mime: []const u8, body: []const u8) !void {
    var hdr: [512]u8 = undefined;
    const head = try std.fmt.bufPrint(
        &hdr,
        "HTTP/1.0 {s}\r\nContent-Type: {s}\r\nContent-Length: {d}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        .{ status, mime, body.len },
    );
    try sendAll(conn.stream.handle, head);
    try sendAll(conn.stream.handle, body);
}

fn sendAll(sock: std.posix.socket_t, data: []const u8) !void {
    var i: usize = 0;
    while (i < data.len) {
        i += try std.posix.send(sock, data[i..], 0);
    }
}

fn mimeFor(path: []const u8) []const u8 {
    if (std.mem.endsWith(u8, path, ".html")) return "text/html; charset=utf-8";
    if (std.mem.endsWith(u8, path, ".js")) return "text/javascript; charset=utf-8";
    if (std.mem.endsWith(u8, path, ".css")) return "text/css; charset=utf-8";
    if (std.mem.endsWith(u8, path, ".wasm")) return "application/wasm";
    if (std.mem.endsWith(u8, path, ".json")) return "application/json; charset=utf-8";
    // A PWA's manifest. Browsers accept application/json, but the correct
    // type is what the samples/ PWA is served with in production, so serve
    // it here too rather than have local and deployed differ.
    if (std.mem.endsWith(u8, path, ".webmanifest")) return "application/manifest+json; charset=utf-8";
    if (std.mem.endsWith(u8, path, ".ring")) return "text/plain; charset=utf-8";
    if (std.mem.endsWith(u8, path, ".svg")) return "image/svg+xml";
    if (std.mem.endsWith(u8, path, ".png")) return "image/png";
    if (std.mem.endsWith(u8, path, ".ico")) return "image/x-icon";
    return "application/octet-stream";
}
