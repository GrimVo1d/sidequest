#!/bin/sh
# Called by Claude Code on every hook event. Forwards the JSON payload from stdin
# to the Sidequest socket and nothing else: it never parses the payload, never
# prints, and always exits 0, so it can never affect Claude Code.

exec >/dev/null 2>&1  # not even a job notice of the shell may reach Claude Code

# The socket is reached by a relative name from its own folder: a unix socket path
# is limited to about 100 bytes, and the project folder may sit deep. Tools are
# called by full path, so a PATH of the agent's choosing changes nothing here.
if cd "${0%/*}/../data" && [ -S sidequest.sock ]; then
    # `nc -w` does not cover a receiver that stops reading (nc blocks on write),
    # so a watchdog kills nc after 1 second no matter what.
    /usr/bin/nc -U -w 1 sidequest.sock <&0 &
    NC=$!
    (/bin/sleep 1; kill "$NC") &
    WATCHDOG=$!
    wait "$NC"
    kill "$WATCHDOG"
fi
# Whatever nc left unread (no game, or nc was stopped) is drained, so Claude Code
# never sees a broken pipe.
/bin/cat
exit 0
