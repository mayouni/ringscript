#!/bin/sh
# ==========================================================================
# RingScript - launcher for macOS, Linux and BSD
# Starts the embedded web server and opens the Playground in your browser.
# First run builds the runtime (requires Zig 0.15+); after that it starts
# instantly. Press Ctrl+C to stop.
#
# Run it by double-clicking (if your desktop is set to execute .sh files)
# or from a terminal:   ./start-playground.sh
# ==========================================================================
set -e
cd "$(dirname "$0")"

SERVER=zig-out/bin/ringscript-serve
URL=http://localhost:8377/

if [ ! -x "$SERVER" ]; then
    if ! command -v zig >/dev/null 2>&1; then
        echo
        echo "  Zig 0.15+ is needed for the first-time build (https://ziglang.org)."
        echo "  After building once, this launcher starts instantly."
        echo
        exit 1
    fi
    echo
    echo "  Building RingScript (first run only)..."
    echo
    zig build -Drelease=true
fi

# Open the browser once the server is listening (backgrounded so the
# server itself keeps this terminal, and Ctrl+C stops everything).
(
    sleep 1
    if command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
    elif command -v open >/dev/null 2>&1; then open "$URL"
    else echo "  Open $URL in your browser."
    fi
) >/dev/null 2>&1 &

exec "$SERVER"
