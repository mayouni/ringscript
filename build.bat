@echo off
echo -------------------------------------------------------
echo Building RingScript Engine
echo -------------------------------------------------------

:: 1. Environment Configuration
set EMSDK_PATH=D:\wasm\emsdk
if not exist "%EMSDK_PATH%\emsdk_env.bat" (
    echo [ERREUR] EMSDK introuvable sur D:
    pause
    exit
)

call "%EMSDK_PATH%\emsdk_env.bat"

echo.
echo [OK] Compilation en cours...

:: 2. emcc Commands
cmd /c emcc bridge.c language/src/rstring.c language/src/rlist.c language/src/ritem.c language/src/ritems.c language/src/rhtable.c language/src/general.c language/src/hashlib.c language/src/state.c language/src/scanner.c language/src/parser.c language/src/codegen.c language/src/objfile.c language/src/vm.c language/src/vmerror.c language/src/vmeval.c language/src/vmexpr.c language/src/vmgc.c language/src/stmt.c language/src/vmlists.c language/src/vmoop.c language/src/vmrange.c language/src/vmstack.c language/src/vmstr.c language/src/vmthread.c language/src/vmfuncs.c language/src/vmvars.c language/src/vmstate.c language/src/vmexit.c language/src/vmperf.c language/src/vmjump.c language/src/vmtry.c language/src/ringapi.c language/src/expr.c language/src/ext.c language/src/dll_e.c language/src/genlib_e.c language/src/file_e.c language/src/math_e.c language/src/list_e.c language/src/os_e.c language/src/meta_e.c language/src/vminfo_e.c -o ringscript.js -I language/include -I language/src -s EXPORTED_FUNCTIONS="['_run_ring']" -s EXPORTED_RUNTIME_METHODS="['ccall']" -s ALLOW_MEMORY_GROWTH=1 -s TOTAL_MEMORY=67108864 -s ASSERTIONS=1 -O2

:: 3. Verification of output code
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERREUR] La compilation a echoue (Code: %ERRORLEVEL%)
) else (
    echo.
    echo [SUCCES] ringscript.js a ete genere avec succes !
)

echo.
pause