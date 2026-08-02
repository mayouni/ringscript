const std = @import("std");

// RingScript — Ring VM compiled to wasm32-wasi with a Zig bridge.
// See REPAIR_PLAN.md §2.5 (Zig-first toolchain decision).

const vm_sources = [_][]const u8{
    "ringvm/src/codegen.c",
    "ringvm/src/expr.c",
    "ringvm/src/ext.c",
    "ringvm/src/file_e.c",
    "ringvm/src/general.c",
    "ringvm/src/genlib_e.c",
    "ringvm/src/hashlib.c",
    "ringvm/src/list_e.c",
    "ringvm/src/math_e.c",
    "ringvm/src/meta_e.c",
    "ringvm/src/objfile.c",
    "ringvm/src/os_e.c",
    "ringvm/src/parser.c",
    "ringvm/src/rhtable.c",
    "ringvm/src/ringapi.c",
    "ringvm/src/ritem.c",
    "ringvm/src/ritems.c",
    "ringvm/src/rlist.c",
    "ringvm/src/rstring.c",
    "ringvm/src/scanner.c",
    "ringvm/src/state.c",
    "ringvm/src/stmt.c",
    "ringvm/src/vm.c",
    "ringvm/src/vmerror.c",
    "ringvm/src/vmeval.c",
    "ringvm/src/vmexit.c",
    "ringvm/src/vmexpr.c",
    "ringvm/src/vmfuncs.c",
    "ringvm/src/vmgc.c",
    "ringvm/src/vminfo_e.c",
    "ringvm/src/vmjump.c",
    "ringvm/src/vmlists.c",
    "ringvm/src/vmoop.c",
    "ringvm/src/vmperf.c",
    "ringvm/src/vmrange.c",
    "ringvm/src/vmstack.c",
    "ringvm/src/vmstate.c",
    "ringvm/src/vmstr.c",
    "ringvm/src/vmthread.c",
    "ringvm/src/vmtry.c",
    "ringvm/src/vmvars.c",
    // Excluded on purpose:
    //   ring.c / ringw.c  — CLI / WinMain entry points (the bridge is the entry)
    //   dll_e.c           — dynamic library loading (RING_NODLL=1; browser loads no DLLs)
};

const vm_cflags = [_][]const u8{
    // No dynamic libraries in a browser runtime (also excludes dll_e.c above).
    "-DRING_NODLL=1",
    // Disables system() and chdir()/getcwd() Ring functions (RING_LIMITEDSYS
    // gates RING_SYSTEMFUNCTION and RING_CURRENTDIRFUNCTIONS in ring.h).
    "-DRING_LIMITEDSYS=1",
    // wasi-libc emulation layers for signal() (state.c) and clock() (general.c).
    "-D_WASI_EMULATED_SIGNAL",
    "-D_WASI_EMULATED_PROCESS_CLOCKS",
    // WASI has no temp directories: tmpfile() is stubbed in wasi_stubs.c
    // (declaration is deprecated-but-present), mkstemp is not declared at
    // all, so stub the single call site in file_e.c at the flag level.
    "-Wno-deprecated-declarations",
    "-Dmkstemp(x)=(-1)",
    // Route every VM file access to the embedded-map resolver in wasi_stubs.c
    // (which is compiled WITHOUT this flag — see below).
    "-Dfopen=rs_fopen",
    "-fno-sanitize=undefined",
};

const stub_cflags = [_][]const u8{
    "-DRING_NODLL=1",
    "-DRING_LIMITEDSYS=1",
    "-D_WASI_EMULATED_SIGNAL",
    "-D_WASI_EMULATED_PROCESS_CLOCKS",
    "-Wno-deprecated-declarations",
    "-fno-sanitize=undefined",
};

pub fn build(b: *std.Build) void {
    // ReleaseSmall is the DEFAULT: playground/ringscript.wasm is a committed
    // release artifact (RingPM downloads it as-is), so an ordinary
    // `zig build` or `zig build serve` must never leave a 2.6 MB debug build
    // in its place. Opt into debugging explicitly with -Ddebug.
    const optimize: std.builtin.OptimizeMode =
        if (b.option(bool, "debug", "Build the wasm runtime in Debug mode") orelse false)
            .Debug
        else
            .ReleaseSmall;
    const target = b.resolveTargetQuery(.{
        .cpu_arch = .wasm32,
        .os_tag = .wasi,
    });

    const mod = b.createModule(.{
        .root_source_file = b.path("src/bridge.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    mod.addIncludePath(b.path("ringvm/include"));
    mod.addCSourceFiles(.{
        .files = &vm_sources,
        .flags = &vm_cflags,
    });
    mod.addCSourceFiles(.{
        .files = &.{"src/wasi_stubs.c"},
        .flags = &stub_cflags,
    });

    const exe = b.addExecutable(.{
        .name = "ringscript",
        .root_module = mod,
    });
    // Reactor model: no main(); exports stay callable for the life of the instance.
    exe.wasi_exec_model = .reactor;
    // Keep the rs_* exports visible in the wasm export table.
    exe.rdynamic = true;
    // Deep C recursion happens in the parser (nested expressions) and in
    // recursive list operations (copy/delete/print of deeply nested lists);
    // the default 1 MB wasm shadow stack overflows well before native does.
    exe.stack_size = 8 * 1024 * 1024;

    b.installArtifact(exe);

    // `zig build` drops the artifact in zig-out/bin/ringscript.wasm; also copy
    // it next to the web pages so the site folder is self-contained.
    const copy = b.addInstallFile(exe.getEmittedBin(), "../playground/ringscript.wasm");
    b.getInstallStep().dependOn(&copy.step);

    // `zig build serve` — build everything, then serve playground/ on localhost.
    // The one command a programmer needs: compile the VM to wasm, refresh
    // the site artifact, start the dev server, print the URLs.
    const serve_exe = b.addExecutable(.{
        .name = "ringscript-serve",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/serve.zig"),
            .target = b.graph.host,
            .optimize = .ReleaseSafe,
            .link_libc = true,
        }),
    });
    // Install the server exe too, so launchers (Start-Playground.bat) can
    // run it directly from zig-out/bin without going through `zig build`.
    b.installArtifact(serve_exe);

    const run_serve = b.addRunArtifact(serve_exe);
    run_serve.setCwd(b.path("."));
    if (b.args) |args| run_serve.addArgs(args);
    run_serve.step.dependOn(b.getInstallStep());
    const serve_step = b.step("serve", "Build the wasm runtime and serve the site on http://localhost:8377/");
    serve_step.dependOn(&run_serve.step);

    // `zig build dist` — cross-compile the dev server for every desktop we
    // ship, into bin/. These are committed so RingPM users (who have Ring but
    // not Zig) get a ready-to-run server: the launchers pick the one matching
    // the host, and RingPM's per-platform file lists download only that one.
    const dist_step = b.step("dist", "Cross-compile the server for all shipped platforms into bin/");
    const dist_targets = [_]struct { q: std.Target.Query, name: []const u8 }{
        .{ .q = .{ .cpu_arch = .x86_64, .os_tag = .windows }, .name = "ringscript-serve-windows-x64.exe" },
        .{ .q = .{ .cpu_arch = .x86_64, .os_tag = .linux, .abi = .musl }, .name = "ringscript-serve-linux-x64" },
        .{ .q = .{ .cpu_arch = .aarch64, .os_tag = .linux, .abi = .musl }, .name = "ringscript-serve-linux-arm64" },
        .{ .q = .{ .cpu_arch = .x86_64, .os_tag = .macos }, .name = "ringscript-serve-macos-x64" },
        .{ .q = .{ .cpu_arch = .aarch64, .os_tag = .macos }, .name = "ringscript-serve-macos-arm64" },
    };
    for (dist_targets) |t| {
        const e = b.addExecutable(.{
            .name = "ringscript-serve",
            .root_module = b.createModule(.{
                .root_source_file = b.path("src/serve.zig"),
                .target = b.resolveTargetQuery(t.q),
                .optimize = .ReleaseSmall,
                .link_libc = true,
            }),
        });
        const install = b.addInstallFile(e.getEmittedBin(), b.fmt("../bin/{s}", .{t.name}));
        dist_step.dependOn(&install.step);
    }
}
