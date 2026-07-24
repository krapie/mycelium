#!/bin/sh
# Stop the `mycelium daemon` started by run.sh, if it's running.
# Idempotent: running this while nothing is running is a no-op.
set -eu

PID_FILE="${HOME}/.mycelium/daemon.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "mycelium daemon is not running (no pidfile)"
  exit 0
fi

PID=$(cat "$PID_FILE")
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  echo "mycelium daemon stopped (pid $PID)"
else
  echo "mycelium daemon is not running (stale pidfile)"
fi
rm -f "$PID_FILE"
