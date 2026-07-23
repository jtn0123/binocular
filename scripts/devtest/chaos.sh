#!/usr/bin/env bash
# Dogfood #6+#7: offline/kill chaos against the running app (blueprint §9).
# Asserts against the app's OWN SQLite database (ground truth), not the UI —
# screen-scraping proved too timing-brittle.
#
# IMPORTANT — build type matters:
#   * A Metro-connected DEV CLIENT loses its JS bundle the moment the device
#     goes offline, so the force-stop-while-offline recovery step can only be
#     exercised on a STANDALONE/RELEASE build (bundle embedded, no Metro).
#   * The pure-offline queueing path (no kill) works on a loaded dev client:
#     toggle airplane mode AFTER the bundle is loaded.
# The queue state machine itself (backoff, drain, boot recovery, the
# five-offline-scans AC) is covered exhaustively by src/queue unit tests;
# this script is the on-device confirmation.
#
# Usage: set the cloud engine + any non-empty key in Settings first, then:
#   ./scripts/devtest/chaos.sh
set -euo pipefail

PKG=com.anonymous.binocular
SCRATCH="${TMPDIR:-/tmp}/binocular-chaos.db"

pull_db() {
  adb shell "run-as $PKG cat files/SQLite/binocular.db" > "$SCRATCH" 2>/dev/null
}
count() { # count <where-clause>
  sqlite3 "$SCRATCH" "SELECT count(*) FROM scans WHERE $1" 2>/dev/null || echo "?"
}
step() { printf '\n— %s\n' "$1"; }

step "baseline queue state"
pull_db
echo "queued=$(count "status='queued'") review=$(count "status='review'") failed=$(count "status='failed'")"

step "airplane mode ON — capture an audit offline"
adb shell cmd connectivity airplane-mode enable
sleep 2
echo "Now, ON THE DEVICE: Scan → Audit bin → pick a bin → shutter."
echo "(Scripted taps are unreliable across the queue-banner layout shift;"
echo " a human tap here keeps the test honest.) Waiting 25s…"
sleep 25
pull_db
QUEUED=$(count "status='queued'")
echo "queued now = $QUEUED"
[ "$QUEUED" != "0" ] && [ "$QUEUED" != "?" ] && echo "OK: offline capture landed in the queue" \
  || echo "NOTE: no queued scan — did the capture happen? (dev client offline can't reload)"

step "airplane mode OFF — let the queue drain"
adb shell cmd connectivity airplane-mode disable
sleep 3
adb shell input keyevent 3   # home → background (AppState trigger)
sleep 1
adb shell am start -n "$PKG/.MainActivity" >/dev/null
sleep 12
pull_db
echo "after reconnect: queued=$(count "status='queued'") failed=$(count "status='failed'") review=$(count "status='review'")"
echo "(a bad/dummy key should turn queued → failed with an auth error;"
echo " a good key turns it → review.)"

echo
echo "chaos pass complete — DB at $SCRATCH. Clean up test scans in the app."
