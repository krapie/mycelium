#!/bin/sh
# Start `mycelium daemon` detached (nohup), if it isn't already running.
# Idempotent: running this while the daemon is already up is a no-op.
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DATA_DIR="${HOME}/.mycelium"
PID_FILE="${DATA_DIR}/daemon.pid"
LOG_FILE="${DATA_DIR}/daemon.log"

mkdir -p "$DATA_DIR"

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "mycelium daemon already running (pid $(cat "$PID_FILE"))"
  exit 0
fi

cd "$ROOT_DIR"
nohup node src/cli.js daemon >>"$LOG_FILE" 2>&1 &
echo $! >"$PID_FILE"
echo "mycelium daemon started (pid $!), logging to $LOG_FILE"
