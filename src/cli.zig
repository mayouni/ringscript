// ==========================================================================
// The RingScript CLI
// ==========================================================================
// One native binary, cross-compiled to every desktop this project ships to,
// already in the starter kit. It needs no Ring installation, no Node, and no
// package manager — which is the whole point: a RingScript user is a web
// developer who downloaded a folder, and the starter kit promises them
// "nothing to install".
//
//   ringscript serve [port] [root]     the dev server
//   ringscript add <name|path>         install a library and wire it in
//   ringscript update [name]           move to the newest version
//   ringscript remove <name>           unwire it and delete its files
//   ringscript list                    what this project uses
//   ringscript search [term]           list the registry, or match a term
//   ringscript pack [folder]           validate a library, ready to publish
//
// Backward compatible: a first argument that parses as a port keeps the old
// `ringscript-serve 8080 mysite` form working, because the starter kit's
// launchers call it that way.
//
// See docs/LIBRARIES.md for the format and the design.
// ==========================================================================

const std = @import("std");
const serve = @import("serve.zig");

const REGISTRY_URL = "https://raw.githubusercontent.com/mayouni/ringscript-registry/main/registry.json";
const LOCK = "ringscript.lock";

/// The highest lockfile schema THIS binary understands. `writePkg` rebuilds
/// every entry field by field from the fields it knows, so an older binary
/// opening a newer lock would not fail -- it would silently rewrite the file
/// and drop every field it does not recognise. `lockRead` refuses instead.
/// Bump this only alongside a change to what a lock entry means, never for
/// its own sake.
const CURRENT_SCHEMA: i64 = 1;

/// This runtime's version, checked against each registry entry's range so a
/// library that needs a newer RingScript is refused here rather than failing
/// later in a browser.
const RINGSCRIPT_VERSION = "0.9";

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const a = gpa.allocator();

    const argv = try std.process.argsAlloc(a);
    defer std.process.argsFree(a, argv);

    if (argv.len < 2) return serve.run(8377, "playground");

    // The legacy positional form the starter kit's launchers use.
    if (std.fmt.parseInt(u16, argv[1], 10)) |port| {
        const root = if (argv.len > 2) argv[2] else "playground";
        return serve.run(port, root);
    } else |_| {}

    const verb = argv[1];
    if (eq(verb, "serve")) {
        const port = if (argv.len > 2) std.fmt.parseInt(u16, argv[2], 10) catch 8377 else 8377;
        const root = if (argv.len > 3) argv[3] else "playground";
        return serve.run(port, root);
    } else if (eq(verb, "add")) {
        if (argv.len < 3) return usageFor("add <name|path> [project]");
        try cmdAdd(a, argv[2], if (argv.len > 3) argv[3] else ".");
    } else if (eq(verb, "update")) {
        // `update` with no name means every library here, so the one
        // optional argument is ambiguous. A folder that exists is the
        // project; anything else is a library name.
        const first = if (argv.len > 2) argv[2] else "";
        const is_project = first.len > 0 and isDir(first);
        const nm = if (is_project) "" else first;
        const proj = if (is_project) first else (if (argv.len > 3) argv[3] else ".");
        try cmdUpdate(a, nm, proj);
    } else if (eq(verb, "remove")) {
        if (argv.len < 3) return usageFor("remove <name> [project]");
        try cmdRemove(a, argv[2], if (argv.len > 3) argv[3] else ".");
    } else if (eq(verb, "list")) {
        try cmdList(a, if (argv.len > 2) argv[2] else ".");
    } else if (eq(verb, "search")) {
        try cmdSearch(a, if (argv.len > 2) argv[2] else "");
    } else if (eq(verb, "pack")) {
        try cmdPack(a, if (argv.len > 2) argv[2] else ".");
    } else {
        usage();
    }
}

fn eq(a: []const u8, b: []const u8) bool {
    return std.mem.eql(u8, a, b);
}

fn isDir(path: []const u8) bool {
    var d = std.fs.cwd().openDir(path, .{}) catch return false;
    d.close();
    return true;
}

fn out(comptime fmt: []const u8, args: anytype) void {
    std.debug.print(fmt, args);
}

fn usageFor(what: []const u8) void {
    out("  usage: ringscript {s}\n", .{what});
}

fn usage() void {
    out(
        \\
        \\  RingScript
        \\
        \\    ringscript serve [port] [root]     the dev server
        \\    ringscript add <name|path>         install a library and wire it in
        \\    ringscript update [name]           move to the newest version
        \\    ringscript remove <name>           unwire it and delete its files
        \\    ringscript list                    what this project uses
        \\    ringscript search [term]           list the registry, or match a term
        \\    ringscript pack [folder]           validate a library
        \\
        \\  Libraries: docs/LIBRARIES.md
        \\
        \\
    , .{});
}

// ==========================================================================
// The manifest
// ==========================================================================

const Manifest = struct {
    parsed: std.json.Parsed(std.json.Value),
    root: std.json.Value,

    fn load(a: std.mem.Allocator, dir: []const u8) !Manifest {
        const path = try std.fs.path.join(a, &.{ dir, "ringscript.json" });
        defer a.free(path);
        const text = try std.fs.cwd().readFileAlloc(a, path, 1 << 20);
        defer a.free(text);
        const parsed = try std.json.parseFromSlice(std.json.Value, a, text, .{});
        return .{ .parsed = parsed, .root = parsed.value };
    }
    fn deinit(self: *Manifest) void {
        self.parsed.deinit();
    }
    fn str(self: Manifest, key: []const u8) []const u8 {
        const v = self.root.object.get(key) orelse return "";
        return switch (v) {
            .string => |s| s,
            else => "",
        };
    }
    /// Every file the manifest declares, in one list. The caller owns it.
    fn files(self: Manifest, a: std.mem.Allocator) !std.ArrayList([]const u8) {
        var acc: std.ArrayList([]const u8) = .empty;
        for ([_][]const u8{ "ring", "web", "css", "assets" }) |key| {
            if (self.root.object.get(key)) |v| {
                if (v == .array) {
                    for (v.array.items) |item| {
                        if (item == .string) try acc.append(a, item.string);
                    }
                }
            }
        }
        const sw = self.str("sw");
        if (sw.len > 0) try acc.append(a, sw);
        return acc;
    }
    fn arrayOf(self: Manifest, key: []const u8) []std.json.Value {
        const v = self.root.object.get(key) orelse return &.{};
        if (v != .array) return &.{};
        return v.array.items;
    }
};

// ==========================================================================
// pack — validate a library before it is published
// ==========================================================================
// Refuses what would break somebody else's page later: a missing file, an
// undeclared surface, or function names with no common prefix. Ring has one
// flat namespace and a page has one window; without this the second library
// you install breaks the first in a way nobody can debug.

fn cmdPack(a: std.mem.Allocator, dir: []const u8) !void {
    var man = Manifest.load(a, dir) catch {
        out("  no ringscript.json in {s}\n", .{dir});
        return;
    };
    defer man.deinit();

    var bad: usize = 0;
    out("  {s} v{s}\n", .{ man.str("name"), man.str("version") });

    var files = try man.files(a);
    defer files.deinit(a);
    for (files.items) |rel| {
        const p = try std.fs.path.join(a, &.{ dir, rel });
        defer a.free(p);
        std.fs.cwd().access(p, .{}) catch {
            out("  MISSING  {s}\n", .{rel});
            bad += 1;
        };
    }

    const provides = man.arrayOf("provides");
    if (provides.len == 0) {
        out("  MISSING  \"provides\" — declare the Ring functions this adds\n", .{});
        bad += 1;
    } else {
        var prefix: []const u8 = provides[0].string;
        for (provides) |p| {
            if (p != .string) continue;
            var keep: usize = 0;
            const max = @min(prefix.len, p.string.len);
            while (keep < max and prefix[keep] == p.string[keep]) keep += 1;
            prefix = prefix[0..keep];
        }
        if (prefix.len < 2) {
            out("  BAD      \"provides\" share no common prefix; two libraries will collide\n", .{});
            bad += 1;
        }
        // and every declared name must actually be in the Ring source
        var src: std.ArrayList(u8) = .empty;
        defer src.deinit(a);
        for (man.arrayOf("ring")) |rv| {
            if (rv != .string) continue;
            const p = try std.fs.path.join(a, &.{ dir, rv.string });
            defer a.free(p);
            const text = std.fs.cwd().readFileAlloc(a, p, 1 << 22) catch continue;
            defer a.free(text);
            try src.appendSlice(a, text);
        }
        const lower = try std.ascii.allocLowerString(a, src.items);
        defer a.free(lower);
        for (provides) |p| {
            if (p != .string) continue;
            const needle = try std.fmt.allocPrint(a, "func {s}", .{p.string});
            defer a.free(needle);
            const lneedle = try std.ascii.allocLowerString(a, needle);
            defer a.free(lneedle);
            if (std.mem.indexOf(u8, lower, lneedle) == null) {
                out("  MISSING  \"provides\" names {s}, not found in the Ring source\n", .{p.string});
                bad += 1;
            }
        }
    }

    if (man.str("global").len == 0) {
        out("  MISSING  \"global\" — name the one global the browser half exposes\n", .{});
        bad += 1;
    }

    if (bad == 0) {
        out("  ok — {d} functions, global {s}\n", .{ provides.len, man.str("global") });
        out("\n  registry row:\n", .{});
        out("    {{ \"name\": \"{s}\", \"summary\": \"{s}\",\n", .{ man.str("name"), man.str("summary") });
        out("      \"repo\": \"<you>/ringscript-{s}\",\n", .{man.str("name")});
        out("      \"versions\": [ {{ \"version\": \"{s}\", \"tag\": \"v{s}\", \"ringscript\": \"{s}\", \"sha256\": \"<from the release tarball>\" }} ] }}\n", .{ man.str("version"), man.str("version"), man.str("ringscript") });
    } else {
        out("  {d} problem(s)\n", .{bad});
    }
}

// ==========================================================================
// add
// ==========================================================================
// The verb that matters. Every other package manager stops at "the files are
// on disk"; the remaining work — a script tag, a stylesheet link, an
// importScripts line — is left to the reader and is where a beginner stalls.

fn cmdAdd(a: std.mem.Allocator, spec: []const u8, project: []const u8) !void {
    // A path to a library folder installs directly. That is how an author
    // tests before publishing, and it needs no network.
    const local = try std.fs.path.join(a, &.{ spec, "ringscript.json" });
    defer a.free(local);
    if (std.fs.cwd().access(local, .{})) |_| {
        return install(a, spec, project, "path");
    } else |_| {}

    addFromRegistry(a, spec, project) catch |e| {
        out("  could not install {s}: {s}\n", .{ spec, @errorName(e) });
    };
}

/// Resolve a name against the registry, download it, prove it is what the
/// registry says it is, and only then unpack. The verify step is why the
/// registry carries a hash at all: without it, "install" means "run whatever
/// that URL happens to serve today".
/// The newest version of `name` this runtime satisfies, or null with a
/// reason already printed. Shared by add and update so they can never
/// disagree about which version is "the" one.
fn resolve(a: std.mem.Allocator, reg: std.json.Parsed(std.json.Value), name: []const u8) ?std.json.Value {
    _ = a;
    const pkgs = blk: {
        const v = reg.value.object.get("packages") orelse break :blk &[_]std.json.Value{};
        if (v != .array) break :blk &[_]std.json.Value{};
        break :blk v.array.items;
    };

    const pkg = for (pkgs) |p| {
        if (p != .object) continue;
        const n = if (p.object.get("name")) |v| (if (v == .string) v.string else "") else "";
        if (std.mem.eql(u8, n, name)) break p;
    } else {
        out("  no library called {s} in the registry\n", .{name});
        return null;
    };

    // Refusing here beats failing later in somebody's browser.
    var chosen: ?std.json.Value = null;
    var skipped: usize = 0;
    if (pkg.object.get("versions")) |vs| {
        if (vs == .array) {
            for (vs.array.items) |v| {
                if (v != .object) continue;
                const need = if (v.object.get("ringscript")) |x| (if (x == .string) x.string else "") else "";
                if (!satisfies(RINGSCRIPT_VERSION, need)) {
                    skipped += 1;
                    continue;
                }
                chosen = v;
            }
        }
    }
    if (chosen == null) {
        out("  {s} has no version this runtime ({s}) satisfies", .{ name, RINGSCRIPT_VERSION });
        if (skipped > 0) out(" — {d} newer one(s) need a newer RingScript", .{skipped});
        out("\n", .{});
    }
    return chosen;
}

fn verOf(v: std.json.Value, key: []const u8) []const u8 {
    const x = v.object.get(key) orelse return "";
    return if (x == .string) x.string else "";
}

fn addFromRegistry(a: std.mem.Allocator, name: []const u8, project: []const u8) !void {
    var reg = try registryFetch(a);
    defer reg.deinit();

    const ver = resolve(a, reg, name) orelse return;

    const tgz = (try fetchVerified(a, name, ver)) orelse return;
    defer a.free(tgz);
    try unpackAndInstall(a, tgz, project, name, null);
}

/// A deliberately small range check: ">=X.Y" or an exact version. Anything
/// else is treated as unsatisfied rather than guessed at.
fn satisfies(have: []const u8, want: []const u8) bool {
    if (want.len == 0) return true;
    if (std.mem.startsWith(u8, want, ">=")) {
        return compareVersions(have, std.mem.trim(u8, want[2..], " ")) >= 0;
    }
    return std.mem.eql(u8, have, want);
}

/// -1, 0 or 1. Dotted numbers, compared part by part.
fn compareVersions(a: []const u8, b: []const u8) i8 {
    var ia = std.mem.splitScalar(u8, a, '.');
    var ib = std.mem.splitScalar(u8, b, '.');
    while (true) {
        const pa = ia.next();
        const pb = ib.next();
        if (pa == null and pb == null) return 0;
        const na = std.fmt.parseInt(u32, pa orelse "0", 10) catch 0;
        const nb = std.fmt.parseInt(u32, pb orelse "0", 10) catch 0;
        if (na < nb) return -1;
        if (na > nb) return 1;
    }
}

fn install(a: std.mem.Allocator, libdir: []const u8, project: []const u8, source: []const u8) !void {
    // Refuse before copying a single file. A guard that only fires once
    // lockWrite is reached would still have left new files on disk and a
    // page rewritten for a project this binary should not be touching.
    {
        var probe = try lockRead(a, project);
        defer probe.deinit();
        if (probe.refused) return;
    }

    var man = try Manifest.load(a, libdir);
    defer man.deinit();
    const name = man.str("name");
    if (name.len == 0) {
        out("  the manifest has no name\n", .{});
        return;
    }

    const dest = try std.fmt.allocPrint(a, "{s}/lib/{s}", .{ project, name });
    defer a.free(dest);
    try std.fs.cwd().makePath(dest);

    var copied: std.ArrayList([]const u8) = .empty;
    defer {
        for (copied.items) |c| a.free(c);
        copied.deinit(a);
    }

    var files = try man.files(a);
    defer files.deinit(a);
    for (files.items) |rel| {
        const from = try std.fs.path.join(a, &.{ libdir, rel });
        defer a.free(from);
        const base = std.fs.path.basename(rel);
        const to = try std.fmt.allocPrint(a, "{s}/{s}", .{ dest, base });
        defer a.free(to);
        std.fs.cwd().copyFile(from, std.fs.cwd(), to, .{}) catch {
            out("  MISSING  {s}\n", .{rel});
            continue;
        };
        try copied.append(a, try std.fmt.allocPrint(a, "lib/{s}/{s}", .{ name, base }));
    }

    try wirePage(a, project, name, man);
    try lockWrite(a, project, name, man.str("version"), source, copied.items);

    out("  added {s} v{s} to {s}\n", .{ name, man.str("version"), project });
    const sw = man.str("sw");
    if (sw.len > 0) {
        out("  service-worker half at lib/{s}/{s} — importScripts it from your sw.js\n", .{ name, std.fs.path.basename(sw) });
    }
}

/// One <script> per web entry before </body>, one <link> per stylesheet in
/// <head>. Idempotent: adding twice does not duplicate a tag.
fn wirePage(a: std.mem.Allocator, project: []const u8, name: []const u8, man: Manifest) !void {
    const html_path = try std.fs.path.join(a, &.{ project, "index.html" });
    defer a.free(html_path);
    var html = std.fs.cwd().readFileAlloc(a, html_path, 1 << 22) catch {
        out("  note: no index.html here — files copied, nothing wired\n", .{});
        return;
    };
    defer a.free(html);

    var changed = false;
    for (man.arrayOf("web")) |v| {
        if (v != .string) continue;
        const tag = try std.fmt.allocPrint(a, "<script src=\"lib/{s}/{s}\"></script>", .{ name, std.fs.path.basename(v.string) });
        defer a.free(tag);
        if (std.mem.indexOf(u8, html, tag) != null) continue;
        const next = try insertBefore(a, html, "</body>", tag);
        a.free(html);
        html = next;
        changed = true;
    }
    for (man.arrayOf("css")) |v| {
        if (v != .string) continue;
        const tag = try std.fmt.allocPrint(a, "<link rel=\"stylesheet\" href=\"lib/{s}/{s}\">", .{ name, std.fs.path.basename(v.string) });
        defer a.free(tag);
        if (std.mem.indexOf(u8, html, tag) != null) continue;
        const next = try insertBefore(a, html, "</head>", tag);
        a.free(html);
        html = next;
        changed = true;
    }
    if (changed) {
        try std.fs.cwd().writeFile(.{ .sub_path = html_path, .data = html });
        out("  wired into index.html\n", .{});
    }
}

fn insertBefore(a: std.mem.Allocator, hay: []const u8, mark: []const u8, what: []const u8) ![]u8 {
    const at = std.mem.indexOf(u8, hay, mark) orelse
        return std.fmt.allocPrint(a, "{s}{s}\n", .{ hay, what });
    return std.fmt.allocPrint(a, "{s}{s}\n{s}", .{ hay[0..at], what, hay[at..] });
}

// ==========================================================================
// remove — undo exactly what add recorded, and nothing else
// ==========================================================================

fn cmdRemove(a: std.mem.Allocator, name: []const u8, project: []const u8) !void {
    var lock = try lockRead(a, project);
    defer lock.deinit();
    if (lock.refused) return;

    const pkgs = lock.packages();
    var found = false;
    var kept: std.ArrayList(std.json.Value) = .empty;
    defer kept.deinit(a);

    for (pkgs) |p| {
        const pname = if (p.object.get("name")) |n| (if (n == .string) n.string else "") else "";
        if (std.mem.eql(u8, pname, name)) {
            found = true;
            try removeFiles(a, p, name, project);
        } else {
            try kept.append(a, p);
        }
    }
    if (!found) {
        out("  {s} is not recorded as installed here\n", .{name});
        return;
    }
    try lockWriteAll(a, project, kept.items);
    out("  removed {s}\n", .{name});
}

/// Drops any line mentioning one of the removed files, which covers the
/// script tag and the stylesheet link without reconstructing either exactly.
fn unwirePage(a: std.mem.Allocator, project: []const u8, files: []std.json.Value) !void {
    const html_path = try std.fs.path.join(a, &.{ project, "index.html" });
    defer a.free(html_path);
    const html = std.fs.cwd().readFileAlloc(a, html_path, 1 << 22) catch return;
    defer a.free(html);

    var kept: std.ArrayList(u8) = .empty;
    defer kept.deinit(a);
    var it = std.mem.splitScalar(u8, html, '\n');
    while (it.next()) |line| {
        var drop = false;
        for (files) |f| {
            if (f != .string) continue;
            if (std.mem.indexOf(u8, line, f.string) != null) drop = true;
        }
        if (drop) continue;
        try kept.appendSlice(a, line);
        try kept.append(a, '\n');
    }
    // splitScalar leaves a trailing empty piece; trim the extra newline
    const data = if (kept.items.len > 0 and kept.items[kept.items.len - 1] == '\n')
        kept.items[0 .. kept.items.len - 1]
    else
        kept.items;
    try std.fs.cwd().writeFile(.{ .sub_path = html_path, .data = data });
}

// ==========================================================================
// list
// ==========================================================================

fn cmdList(a: std.mem.Allocator, project: []const u8) !void {
    var lock = try lockRead(a, project);
    defer lock.deinit();
    if (lock.refused) return;
    const pkgs = lock.packages();
    if (pkgs.len == 0) {
        out("  no libraries installed here\n", .{});
        return;
    }
    for (pkgs) |p| {
        const n = if (p.object.get("name")) |v| (if (v == .string) v.string else "?") else "?";
        const ver = if (p.object.get("version")) |v| (if (v == .string) v.string else "?") else "?";
        const src = if (p.object.get("source")) |v| (if (v == .string) v.string else "") else "";
        out("  {s}  v{s}  ({s})\n", .{ n, ver, src });
    }
}

fn cmdSearch(a: std.mem.Allocator, term: []const u8) !void {
    var reg = registryFetch(a) catch |e| {
        out("  could not read the registry ({s})\n", .{@errorName(e)});
        out("  {s}\n", .{REGISTRY_URL});
        return;
    };
    defer reg.deinit();

    const pkgs = blk: {
        const v = reg.value.object.get("packages") orelse break :blk &[_]std.json.Value{};
        if (v != .array) break :blk &[_]std.json.Value{};
        break :blk v.array.items;
    };
    // Say what was searched for. Without this, `ringscript search offline`
    // reads as "search, offline" — a mode, not a term — and the matching
    // line then contains the word "offline" too, which settles nothing.
    if (term.len > 0) {
        out("\n  Libraries matching \"{s}\":\n\n", .{term});
    } else {
        out("\n  Libraries in the registry:\n\n", .{});
    }

    var shown: usize = 0;
    var last_name: []const u8 = "";
    for (pkgs) |pkg| {
        if (pkg != .object) continue;
        const n = if (pkg.object.get("name")) |v| (if (v == .string) v.string else "") else "";
        const sum = if (pkg.object.get("summary")) |v| (if (v == .string) v.string else "") else "";
        if (term.len > 0 and
            std.mem.indexOf(u8, n, term) == null and
            std.mem.indexOf(u8, sum, term) == null) continue;

        // the newest version listed, so the line says what you would get
        var newest: []const u8 = "";
        if (pkg.object.get("versions")) |vs| {
            if (vs == .array) {
                for (vs.array.items) |v| {
                    if (v != .object) continue;
                    if (v.object.get("version")) |x| {
                        if (x == .string) newest = x.string;
                    }
                }
            }
        }
        out("    {s}  {s}\n      {s}\n", .{ n, newest, sum });
        last_name = n;
        shown += 1;
    }

    if (shown == 0) {
        out("    nothing matches\n\n", .{});
        return;
    }
    // End on the command they actually wanted, so the next step is not a guess.
    if (shown == 1) {
        out("\n  Install it:  ringscript add {s}\n\n", .{last_name});
    } else {
        out("\n  Install one: ringscript add <name>\n\n", .{});
    }
}


// ==========================================================================
// The registry, over plain HTTPS
// ==========================================================================
// No server, no account, no publish token: the registry is one JSON file in
// a repository, and a pull request is the review. Fetched with Zig's own
// TLS client, so this stays a single binary with nothing to install.

fn httpGet(a: std.mem.Allocator, url: []const u8) ![]u8 {
    var client: std.http.Client = .{ .allocator = a };
    defer client.deinit();

    // fetch wants the new std.Io.Writer; Allocating is the bridge from an
    // owned buffer to it.
    var sink: std.Io.Writer.Allocating = .init(a);
    errdefer sink.deinit();

    const res = try client.fetch(.{
        .location = .{ .url = url },
        .response_writer = &sink.writer,
    });
    if (res.status != .ok) return error.HttpStatus;
    return sink.toOwnedSlice();
}

/// Where the last good registry is kept, so a machine that cannot reach
/// GitHub can still install. Per user, not per project: three projects on
/// one laptop should not each need their own copy.
fn cachePath(a: std.mem.Allocator) ![]u8 {
    const dir = try std.fs.getAppDataDir(a, "ringscript");
    defer a.free(dir);
    return std.fs.path.join(a, &.{ dir, "registry.json" });
}

/// Verified bytes for a version row, from the cache or the network. Null
/// means it was refused or the row was unusable, with the reason printed.
/// The caller owns the result.
///
/// Kept separate from unpacking on purpose: `update` must know the new
/// version is in hand **before** it removes the old one, or a failed fetch
/// leaves a project with neither.
fn fetchVerified(a: std.mem.Allocator, name: []const u8, ver: std.json.Value) !?[]u8 {
    const url = verOf(ver, "url");
    const want = verOf(ver, "sha256");
    const vnum = if (verOf(ver, "version").len > 0) verOf(ver, "version") else "?";
    if (url.len == 0 or want.len == 0) {
        out("  the registry row for {s} has no url or no sha256\n", .{name});
        return null;
    }

    if (packageCacheRead(a, want)) |hit| {
        out("  {s} v{s} — already downloaded, no network needed\n", .{ name, vnum });
        return hit;
    }

    out("  fetching {s} v{s}\n", .{ name, vnum });
    const fetched = httpGet(a, url) catch |e| {
        out("  could not download it ({s})\n", .{@errorName(e)});
        return null;
    };

    var digest: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(fetched, &digest, .{});
    var got: [64]u8 = undefined;
    _ = std.fmt.bufPrint(&got, "{x}", .{digest}) catch unreachable;
    if (!std.mem.eql(u8, &got, want)) {
        out("  REFUSED — the download does not match the registry\n", .{});
        out("    expected {s}\n", .{want});
        out("    got      {s}\n", .{got});
        a.free(fetched);
        return null;
    }
    out("  verified {d} bytes against the registry hash\n", .{fetched.len});
    packageCacheWrite(a, want, fetched);
    return fetched;
}

/// Unpack somewhere temporary, so a bad archive cannot leave half a library
/// in lib/, and only then install.
///
/// `replace` is the lockfile entry of a version being superseded. It is
/// deleted *after* the new one is unpacked and before it is installed, so
/// the moment where the project has no copy of the library is as short as
/// this can make it.
fn unpackAndInstall(
    a: std.mem.Allocator,
    tgz: []const u8,
    project: []const u8,
    name: []const u8,
    replace: ?std.json.Value,
) !void {
    const tmp = try std.fmt.allocPrint(a, "{s}/.ringscript-unpack", .{project});
    defer a.free(tmp);
    std.fs.cwd().deleteTree(tmp) catch {};
    try std.fs.cwd().makePath(tmp);
    defer std.fs.cwd().deleteTree(tmp) catch {};

    var dir = try std.fs.cwd().openDir(tmp, .{});
    defer dir.close();

    var in = std.Io.Reader.fixed(tgz);
    var win: [std.compress.flate.max_window_len]u8 = undefined;
    var gz = std.compress.flate.Decompress.init(&in, .gzip, &win);
    // strip_components: the tarball holds one <name>-<version>/ directory
    try std.tar.pipeToFileSystem(dir, &gz.reader, .{ .strip_components = 1 });

    if (replace) |old| try removeFiles(a, old, name, project);
    try install(a, tmp, project, "registry");
}

/// Delete what a lockfile entry recorded — its files, its tags, its folder.
/// The lockfile itself is left alone: `remove` rewrites it without this
/// package, `update` is about to write a newer entry over the top.
fn removeFiles(a: std.mem.Allocator, p: std.json.Value, name: []const u8, project: []const u8) !void {
    if (p.object.get("files")) |fv| {
        if (fv == .array) {
            // unwire first, while the paths are still known
            try unwirePage(a, project, fv.array.items);
            for (fv.array.items) |f| {
                if (f != .string) continue;
                const path = try std.fs.path.join(a, &.{ project, f.string });
                defer a.free(path);
                std.fs.cwd().deleteFile(path) catch {};
            }
        }
    }
    const dir = try std.fmt.allocPrint(a, "{s}/lib/{s}", .{ project, name });
    defer a.free(dir);
    std.fs.cwd().deleteDir(dir) catch {};
}

// ==========================================================================
// update — move to the newest version this runtime satisfies
// ==========================================================================
// With a name, that library; without one, everything the lockfile records.
// A path install is left alone: this cannot know whether the folder it came
// from still exists, or still holds what it held.

fn cmdUpdate(a: std.mem.Allocator, name: []const u8, project: []const u8) !void {
    var lock = try lockRead(a, project);
    defer lock.deinit();
    if (lock.refused) return;
    const pkgs = lock.packages();
    if (pkgs.len == 0) {
        out("  no libraries installed here\n", .{});
        return;
    }

    var reg = registryFetch(a) catch |e| {
        out("  could not read the registry ({s})\n", .{@errorName(e)});
        return;
    };
    defer reg.deinit();

    var looked: usize = 0;
    var moved: usize = 0;

    for (pkgs) |p| {
        const pname = if (p.object.get("name")) |v| (if (v == .string) v.string else "") else "";
        const pver = if (p.object.get("version")) |v| (if (v == .string) v.string else "") else "";
        const psrc = if (p.object.get("source")) |v| (if (v == .string) v.string else "") else "";
        if (pname.len == 0) continue;
        if (name.len > 0 and !std.mem.eql(u8, name, pname)) continue;
        looked += 1;

        if (std.mem.eql(u8, psrc, "path")) {
            out("  {s} v{s} — installed from a path; re-add it from that folder to refresh\n", .{ pname, pver });
            continue;
        }

        const ver = resolve(a, reg, pname) orelse continue;
        const newv = verOf(ver, "version");
        if (compareVersions(newv, pver) <= 0) {
            out("  {s} v{s} — current\n", .{ pname, pver });
            continue;
        }

        out("  {s} v{s} -> v{s}\n", .{ pname, pver, newv });

        // Fetch and verify FIRST. Only once the new version is in hand is
        // it safe to take the old one out.
        const tgz = (try fetchVerified(a, pname, ver)) orelse {
            out("  kept v{s} — the new version could not be fetched\n", .{pver});
            continue;
        };
        defer a.free(tgz);

        try unpackAndInstall(a, tgz, project, pname, p);
        moved += 1;
    }

    if (looked == 0) {
        if (name.len > 0) out("  {s} is not installed here\n", .{name});
    } else if (moved == 0) {
        out("  nothing to update\n", .{});
    }
}

/// A downloaded package, named by its own sha256. The caller owns the
/// returned bytes; null means "not cached, or cached wrong".
fn packageCacheRead(a: std.mem.Allocator, sha: []const u8) ?[]u8 {
    const dir = std.fs.getAppDataDir(a, "ringscript") catch return null;
    defer a.free(dir);
    const path = std.fmt.allocPrint(a, "{s}/packages/{s}.tar.gz", .{ dir, sha }) catch return null;
    defer a.free(path);
    const bytes = std.fs.cwd().readFileAlloc(a, path, 1 << 26) catch return null;

    // Re-check on the way out. A cache entry that no longer hashes to its
    // own name is a corrupted file, not a package, and it must not be
    // trusted just because it is local.
    var digest: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(bytes, &digest, .{});
    var got: [64]u8 = undefined;
    _ = std.fmt.bufPrint(&got, "{x}", .{digest}) catch {
        a.free(bytes);
        return null;
    };
    if (!std.mem.eql(u8, &got, sha)) {
        a.free(bytes);
        std.fs.cwd().deleteFile(path) catch {};
        return null;
    }
    return bytes;
}

fn packageCacheWrite(a: std.mem.Allocator, sha: []const u8, bytes: []const u8) void {
    const dir = std.fs.getAppDataDir(a, "ringscript") catch return;
    defer a.free(dir);
    const sub = std.fmt.allocPrint(a, "{s}/packages", .{dir}) catch return;
    defer a.free(sub);
    std.fs.cwd().makePath(sub) catch return;
    const path = std.fmt.allocPrint(a, "{s}/{s}.tar.gz", .{ sub, sha }) catch return;
    defer a.free(path);
    std.fs.cwd().writeFile(.{ .sub_path = path, .data = bytes }) catch return;
}

fn cacheWrite(a: std.mem.Allocator, text: []const u8) void {
    const path = cachePath(a) catch return;
    defer a.free(path);
    const dir = std.fs.path.dirname(path) orelse return;
    std.fs.cwd().makePath(dir) catch return;
    // A cache that fails to write is not an error worth stopping an install
    // for; the next run simply fetches again.
    std.fs.cwd().writeFile(.{ .sub_path = path, .data = text }) catch return;
}

/// RINGSCRIPT_REGISTRY overrides the default, and may be a URL or a local
/// file. A mirror inside an organisation, a copy on a machine that cannot
/// reach GitHub, or a fixture under test — all the same mechanism.
///
/// Otherwise: the network first, and the cache when the network is not
/// there. That order matters. Cache-first would be faster and would serve
/// stale rows to somebody who is perfectly well connected; this way a
/// connected machine is always current, and a disconnected one still works.
///
/// A stale registry cannot make an install unsafe — the tarball's sha256 is
/// still checked against whatever row was read. The worst a cache can do is
/// offer an older version than exists.
fn registryFetch(a: std.mem.Allocator) !std.json.Parsed(std.json.Value) {
    const override = std.process.getEnvVarOwned(a, "RINGSCRIPT_REGISTRY") catch null;
    defer if (override) |o| a.free(o);

    if (override) |where| {
        // An override is deliberate, so it is never cached and never
        // falls back — if a mirror is down you want to hear about it.
        const text = if (std.mem.startsWith(u8, where, "http"))
            try httpGet(a, where)
        else
            try std.fs.cwd().readFileAlloc(a, where, 1 << 22);
        defer a.free(text);
        return std.json.parseFromSlice(std.json.Value, a, text, .{});
    }

    if (httpGet(a, REGISTRY_URL)) |text| {
        defer a.free(text);
        // only cache something that parses, or the fallback inherits the
        // failure it was supposed to protect against
        const parsed = try std.json.parseFromSlice(std.json.Value, a, text, .{});
        cacheWrite(a, text);
        return parsed;
    } else |net_err| {
        const path = cachePath(a) catch return net_err;
        defer a.free(path);
        const text = std.fs.cwd().readFileAlloc(a, path, 1 << 22) catch return net_err;
        defer a.free(text);
        const parsed = std.json.parseFromSlice(std.json.Value, a, text, .{}) catch return net_err;
        out("  offline ({s}) — using the registry cached {s}\n", .{ @errorName(net_err), cacheAge(path) });
        return parsed;
    }
}

/// "today" / "3 days ago" — enough for a human to judge whether a missing
/// library is missing or merely newer than the cache.
fn cacheAge(path: []const u8) []const u8 {
    const f = std.fs.cwd().openFile(path, .{}) catch return "at an unknown time";
    defer f.close();
    const st = f.stat() catch return "at an unknown time";
    const age_s = @divTrunc(std.time.nanoTimestamp() - st.mtime, std.time.ns_per_s);
    if (age_s < 60 * 60 * 24) return "today";
    if (age_s < 60 * 60 * 24 * 2) return "yesterday";
    if (age_s < 60 * 60 * 24 * 30) return "in the last month";
    return "over a month ago";
}

// ==========================================================================
// The lockfile
// ==========================================================================
// Plain JSON so a human can read it and a diff is legible.

const Lock = struct {
    parsed: ?std.json.Parsed(std.json.Value),
    /// The lockfile's schema is newer than CURRENT_SCHEMA. Every field this
    /// binary would write is already lost from `parsed`, so the only correct
    /// move for a caller is to stop -- `packages()` deliberately returns
    /// nothing rather than a truncated view that looks complete.
    refused: bool = false,

    fn deinit(self: *Lock) void {
        if (self.parsed) |*p| p.deinit();
    }
    fn packages(self: Lock) []std.json.Value {
        const p = self.parsed orelse return &.{};
        const v = p.value.object.get("packages") orelse return &.{};
        if (v != .array) return &.{};
        return v.array.items;
    }
};

/// A missing "schema" predates the field and reads as 1 -- the only value
/// that has ever existed. Refusal prints its own message so every caller
/// can just check `.refused` and stop.
fn lockRead(a: std.mem.Allocator, project: []const u8) !Lock {
    const path = try std.fs.path.join(a, &.{ project, LOCK });
    defer a.free(path);
    const text = std.fs.cwd().readFileAlloc(a, path, 1 << 20) catch return .{ .parsed = null };
    defer a.free(text);
    var parsed = std.json.parseFromSlice(std.json.Value, a, text, .{}) catch return .{ .parsed = null };

    const schema: i64 = if (parsed.value.object.get("schema")) |v|
        (if (v == .integer) v.integer else 1)
    else
        1;
    if (schema > CURRENT_SCHEMA) {
        out(
            "  this project's lockfile was written by a newer ringscript (schema {d}, this one knows {d}) -- refusing rather than rewriting it\n",
            .{ schema, CURRENT_SCHEMA },
        );
        parsed.deinit();
        return .{ .parsed = null, .refused = true };
    }
    return .{ .parsed = parsed };
}

fn lockWrite(a: std.mem.Allocator, project: []const u8, name: []const u8, version: []const u8, source: []const u8, files: []const []const u8) !void {
    var buf: std.ArrayList(u8) = .empty;
    defer buf.deinit(a);
    const w = buf.writer(a);

    var lock = try lockRead(a, project);
    defer lock.deinit();
    // The guard belongs in `install()`, before any file is touched -- this
    // is a second, defensive check so lockWrite can never be the thing that
    // silently rewrites a lock it does not understand, whoever calls it.
    if (lock.refused) return error.LockSchemaNewer;

    try w.writeAll("{\n  \"schema\": 1,\n  \"packages\": [\n");
    var first = true;
    for (lock.packages()) |p| {
        const pn = if (p.object.get("name")) |v| (if (v == .string) v.string else "") else "";
        if (std.mem.eql(u8, pn, name)) continue; // replaced below
        if (!first) try w.writeAll(",\n");
        first = false;
        try writePkg(w, p);
    }
    if (!first) try w.writeAll(",\n");
    try w.print("    {{ \"name\": \"{s}\", \"version\": \"{s}\", \"source\": \"{s}\", \"files\": [", .{ name, version, source });
    for (files, 0..) |f, i| {
        if (i > 0) try w.writeAll(", ");
        try w.print("\"{s}\"", .{f});
    }
    try w.writeAll("] }\n  ]\n}\n");

    const path = try std.fs.path.join(a, &.{ project, LOCK });
    defer a.free(path);
    try std.fs.cwd().writeFile(.{ .sub_path = path, .data = buf.items });
}

fn lockWriteAll(a: std.mem.Allocator, project: []const u8, pkgs: []std.json.Value) !void {
    var buf: std.ArrayList(u8) = .empty;
    defer buf.deinit(a);
    const w = buf.writer(a);
    try w.writeAll("{\n  \"schema\": 1,\n  \"packages\": [\n");
    for (pkgs, 0..) |p, i| {
        if (i > 0) try w.writeAll(",\n");
        try writePkg(w, p);
    }
    try w.writeAll("\n  ]\n}\n");
    const path = try std.fs.path.join(a, &.{ project, LOCK });
    defer a.free(path);
    try std.fs.cwd().writeFile(.{ .sub_path = path, .data = buf.items });
}

fn writePkg(w: anytype, p: std.json.Value) !void {
    const n = if (p.object.get("name")) |v| (if (v == .string) v.string else "") else "";
    const ver = if (p.object.get("version")) |v| (if (v == .string) v.string else "") else "";
    const src = if (p.object.get("source")) |v| (if (v == .string) v.string else "") else "";
    try w.print("    {{ \"name\": \"{s}\", \"version\": \"{s}\", \"source\": \"{s}\", \"files\": [", .{ n, ver, src });
    if (p.object.get("files")) |fv| {
        if (fv == .array) {
            for (fv.array.items, 0..) |f, i| {
                if (i > 0) try w.writeAll(", ");
                if (f == .string) try w.print("\"{s}\"", .{f.string});
            }
        }
    }
    try w.writeAll("] }");
}
