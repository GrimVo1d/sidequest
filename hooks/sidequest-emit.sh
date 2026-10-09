#!/bin/sh
# Called by Claude Code on every hook event. Forwards the JSON payload from stdin
# to the Sidequest socket and nothing else: it never parses the payload, never
# prints, and always exits 0, so it can never affect Claude Code.

SOCK="$(dirname "$0")/../data/sidequest.sock"

if [ -S "$SOCK" ]; then
    # `nc -w` does not cover a receiver that stops reading (nc blocks on write),
    # so a watchdog kills nc after 1 second no matter what.
    nc -U -w 1 "$SOCK" <&0 >/dev/null 2>&1 &
    NC=$!
    (sleep 1; kill "$NC") >/dev/null 2>&1 &
    WATCHDOG=$!
    wait "$NC" 2>/dev/null
    kill "$WATCHDOG" 2>/dev/null
else
    # Game is not running: drain stdin so Claude Code never sees a broken pipe.
    cat >/dev/null 2>&1
fi
exit 0
