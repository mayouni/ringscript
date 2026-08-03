@echo off
rem ==========================================================================
rem  RingScript starter - double-click this file.
rem
rem  It starts a small web server for THIS folder and opens your browser.
rem  Nothing is installed, and nothing goes on the internet.
rem  Close the server window to stop.
rem ==========================================================================
setlocal

rem pushd, not "cd /d": %~dp0 ends with a backslash, and inside quotes that
rem backslash escapes the closing quote. On a path with spaces - a Desktop
rem under "C:\Users\First Last\", say - the argument then splits and the
rem folder change fails. pushd handles both cases.
pushd "%~dp0" 2>nul
if errorlevel 1 (
    echo.
    echo   Could not open this folder:
    echo     %~dp0
    echo.
    pause
    exit /b 1
)

rem Absolute paths from here on, so nothing depends on which folder a
rem child process happens to start in.
set "RSDIR=%CD%"
set "RSEXE=%RSDIR%\server\ringscript-serve-windows-x64.exe"
set "RSPORT=8377"

if not exist "%RSEXE%" (
    echo.
    echo   The server file is missing:
    echo     %RSEXE%
    echo.
    echo   Unzip the whole starter folder, keeping it together, and try again.
    echo.
    popd
    pause
    exit /b 1
)

echo.
echo   Starting RingScript at http://localhost:%RSPORT%
echo   Keep the server window open. Close it to stop.
echo.

start "RingScript server - close this window to stop" "%RSEXE%" %RSPORT% "%RSDIR%"

rem A moment for the server to bind, before the browser asks for the page.
rem ping rather than timeout: timeout fails outright if input is redirected.
ping -n 2 127.0.0.1 >nul 2>&1

start "" "http://localhost:%RSPORT%/"

popd
exit /b 0
