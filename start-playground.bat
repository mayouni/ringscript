@echo off
rem ==========================================================================
rem RingScript - double-click launcher
rem Starts the embedded web server and opens the Playground in your browser.
rem First run builds the runtime (requires Zig 0.15+); after that it starts
rem instantly. Close the server window to stop.
rem ==========================================================================
cd /d "%~dp0"

if exist zig-out\bin\ringscript-serve.exe goto run

where zig >nul 2>nul
if errorlevel 1 (
    echo.
    echo   Zig 0.15+ is needed for the first-time build ^(https://ziglang.org^).
    echo   After building once, this launcher starts instantly.
    echo.
    pause
    exit /b 1
)
echo.
echo   Building RingScript ^(first run only^)...
echo.
zig build -Drelease=true
if errorlevel 1 (
    echo.
    echo   Build failed - see messages above.
    echo.
    pause
    exit /b 1
)

:run
start "RingScript server - close this window to stop" zig-out\bin\ringscript-serve.exe
timeout /t 1 /nobreak >nul
start "" "http://localhost:8377/"
exit /b 0
