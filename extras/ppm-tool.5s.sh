#!/bin/bash

# PPM (Propper Project Mapper) - SwiftBar Plugin
# -----------------------------------------
# Installation:
#   1. Install SwiftBar: https://swiftbar.app
#   2. Copy this file to your SwiftBar plugins folder
#   3. Edit PROPPER_DIR below to point to your installation
#   4. Make executable: chmod +x propper.5s.sh
#
# The "5s" in the filename means SwiftBar refreshes status every 5 seconds.
# Change to 10s, 30s, 1m, etc. as preferred.

# ── CONFIG ── Edit this path to your PPM installation
PROPPER_DIR="$HOME/propper-project-mapper"

# ── Read port from .env or default to 3333 ──
if [ -f "$PROPPER_DIR/.env" ]; then
  PORT=$(grep -E "^PORT=" "$PROPPER_DIR/.env" | cut -d= -f2 | tr -d '[:space:]')
fi
PORT=${PORT:-3333}
URL="http://localhost:$PORT"

# ── Check if running ──
if lsof -iTCP:$PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
  RUNNING=true
  MANIFESTS=$(ls "$PROPPER_DIR/manifests/"*.json 2>/dev/null | wc -l | tr -d '[:space:]')
  echo "P:$MANIFESTS"
else
  RUNNING=false
  echo "P:off | color=#666666"
fi

echo "---"

# ── Menu items ──
if [ "$RUNNING" = true ]; then
  echo "Open in Browser | href=$URL"
  echo "---"
  echo "Refresh Manifests | bash='curl' param1='-s' param2='-X' param3='POST' param4='$URL/api/regenerate/all' terminal=false refresh=true"
  echo "---"
  echo "Stop Server | bash='kill' param1=\$(lsof -iTCP:$PORT -sTCP:LISTEN -t) terminal=false refresh=true"
else
  echo "Start Server | bash='$SHELL' param1='-c' param2='cd $PROPPER_DIR && node server.js &' terminal=false refresh=true"
fi

echo "---"
echo "Port: $PORT | color=#666666"
echo "Dir: $PROPPER_DIR | color=#666666"
echo "Open Folder | bash='open' param1='$PROPPER_DIR' terminal=false"
