const std = @import("std");

// RingScript — Ring VM compiled to wasm32-wasi with a Zig bridge.
// See REPAIR_PLAN.md §2.5 (Zig-first toolchain decision).

const vm_sources = [_][]const u8{
    "language/src/codegen.c",
    "language/src/expr.c",
    "language/src/ext.c",
    "language/src/file_e.c",
    "language/src/general.c",
    "language/src/genlib_e.c",
    "language/src/hashlib.c",
    "language/src/list_e.c",
    "language/src/math_e.c",
    "language/src/meta_e.c",
    "language/src/objfile.c",
    "language/src/os_e.c",
    "language/src/parser.c",
    "language/src/rhtable.c",
    "language/src/ringapi.c",
    "language/src/ritem.c",
    "language/src/ritems.c",
    "language/src/rlist.c",
    "language/src/rstring.c",
    "language/src/scanner.c",
    "language/src/state.c",
    "language/src/stmt.c",
    "language/src/vm.c",
    "language/src/vmerror.c",
    "language/src/vmeval.c",
    "language/src/vmexit.c",
    "language/src/vmexpr.c",
    "language/src/vmfuncs.c",
    "language/src/vmgc.c",
    "language/src/vminfo_e.c",
    "language/src/vmjump.c",
    "language/src/vmlists.c",
    "language/src/vmoop.c",
    "language/src/vmperf.c",
    "language/src/vmrange.c",
    "language/src/vmstack.c",
    "language/src/vmstate.c",
    "language/src/vmstr.c",
    "language/src/vmthread.c",
    "language/src/vmtry.c",
    "language/src/vmvars.c",
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
    const optimize = b.standardOptimizeOption(.{ .preferred_optimize_mode = .ReleaseSmall });
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
    mod.addIncludePath(b.path("language/include"));
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
}
