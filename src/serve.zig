// ==========================================================================
// RingScript dev server — `zig build serve`
// ==========================================================================
// Minimal static file server over std.net (no dependencies): serves the
// web/ folder so the wasm module loads over HTTP the way browsers require.
// HTTP/1.0-style: one request per connection, then close. Serves .wasm with
// the correct MIME type so WebAssembly.instantiateStreaming works.
//
// Usage: ringscript-serve [port]        (default 8377, root: ./web)
// ==========================================================================

const std = @import("std");

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    const allocator = gpa.allocator();

    var port: u16 = 8377;
    var args = try std.process.argsWithAllocator(allocator);
    defer args.deinit();
    _ = args.next(); // exe name
    if (args.next()) |arg| {
        port = std.fmt.parseInt(u16, arg, 10) catch 8377;
    }

    const address = try std.net.Address.parseIp4("127.0.0.1", port);
    var server = try address.listen(.{ .reuse_address = true });
    defer server.deinit();

    std.debug.print(
        \\
        \\  RingScript dev server
        \\  ---------------------
        \\  Playground : http://localhost:{d}/
        \\  Docs       : docs/ folder (markdown)
        \\
        \\  Ctrl+C to stop
        \\
        \\
    , .{port});

    while (true) {
        const conn = server.accept() catch continue;
        handle(allocator, conn) catch {};
    }
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

    const full = std.fs.path.join(allocator, &.{ "web", eff_path[1..] }) catch return;
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
    if (std.mem.endsWith(u8, path, ".ring")) return "text/plain; charset=utf-8";
    if (std.mem.endsWith(u8, path, ".svg")) return "image/svg+xml";
    if (std.mem.endsWith(u8, path, ".png")) return "image/png";
    if (std.mem.endsWith(u8, path, ".ico")) return "image/x-icon";
    return "application/octet-stream";
}
