#!/bin/sh
# ==========================================================================
#  RingScript starter - double-click this file, or run ./start-mac-linux.sh
#
#  It starts a small web server for THIS folder and opens your browser.
#  Nothing is installed, and nothing goes on the internet.
#  Press Ctrl+C in this window to stop.
# ==========================================================================
cd "$(dirname "$0")" || exit 1

# Pick the server built for this machine.
case "$(uname -s)" in
    Darwin) os=macos ;;
    Linux)  os=linux ;;
    *)      echo "  Unsupported system: $(uname -s)"; exit 1 ;;
esac
case "$(uname -m)" in
    arm64|aarch64) arch=arm64 ;;
    x86_64|amd64)  arch=x64 ;;
    *)             echo "  Unsupported processor: $(uname -m)"; exit 1 ;;
esac

SERVER="server/ringscript-serve-$os-$arch"

if [ ! -f "$SERVER" ]; then
    echo ""
    echo "  The server file is missing:"
    echo "    $SERVER"
    echo ""
    echo "  Unzip the whole starter folder, keeping it together, and try again."
    echo ""
    exit 1
fi

# Zip files do not carry the executable permission, so set it here.
chmod +x "$SERVER" 2>/dev/null

echo ""
echo "  Starting RingScript at http://localhost:8377"
echo "  Press Ctrl+C to stop."
echo ""

# Open the browser once the server has had a moment to start.
( sleep 1
  if   command -v open    >/dev/null 2>&1; then open    "http://localhost:8377/"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:8377/"
  else echo "  Open this in your browser:  http://localhost:8377/"
  fi ) &

# Run in the foreground: Ctrl+C stops it, and errors stay visible.
exec "$SERVER" 8377 .
