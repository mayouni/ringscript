@echo off
rem ==========================================================================
rem  RingScript starter - double-click this file.
rem
rem  It starts a small web server for THIS folder and opens your browser.
rem  Nothing is installed, and nothing goes on the internet.
rem  Close the server window to stop.
rem ==========================================================================
cd /d "%~dp0"

if not exist "server\ringscript-serve-windows-x64.exe" (
    echo.
    echo   The server file is missing:
    echo     server\ringscript-serve-windows-x64.exe
    echo.
    echo   Unzip the whole starter folder, keeping it together, and try again.
    echo.
    pause
    exit /b 1
)

echo.
echo   Starting RingScript at http://localhost:8377
echo   Keep the server window open. Close it to stop.
echo.

start "RingScript server - close this window to stop" ^
    "server\ringscript-serve-windows-x64.exe" 8377 .

rem Give the server a moment before the browser asks for the page.
timeout /t 1 /nobreak >nul
start "" "http://localhost:8377/"

exit /b 0
