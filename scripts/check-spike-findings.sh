#!/usr/bin/env bash
# Checks that a findings document records a verdict for each named surface.
#
# Usage: check-spike-findings.sh <findings.md> <surface>...
#
# For every surface the document must hold a table row of the form
#   | <surface> | PASS or FAIL | <iOS version> | <device> | <server version> | <app version> | <observed> |
# with the iOS version, device, server version and observation filled in
# (not empty, "TBD" or "?"; the app version may be "n/a"). It must also have a
# "## Consequence for MVP" section with text under it.
# Exits non-zero on the first missing or incomplete entry.
set -euo pipefail

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

[ "$#" -ge 2 ] || fail "usage: $0 <findings.md> <surface>..."
doc="$1"
shift
[ -f "$doc" ] || fail "findings document $doc does not exist"

placeholder() {
    local value
    value="$(echo "$1" | sed 's/^ *//; s/ *$//')"
    [ -z "$value" ] || [ "$value" = "TBD" ] || [ "$value" = "?" ]
}

for surface in "$@"; do
    row="$(grep -E "^\| *${surface} *\|" "$doc" | head -1 || true)"
    [ -n "$row" ] || fail "no row for surface '$surface' in $doc"

    IFS='|' read -r _ _ verdict ios device server app observed _ <<< "$row"
    verdict="$(echo "$verdict" | sed 's/^ *//; s/ *$//')"
    case "$verdict" in
        PASS|FAIL) ;;
        *) fail "surface '$surface' has verdict '$verdict', expected PASS or FAIL" ;;
    esac
    placeholder "$ios" && fail "surface '$surface' has no iOS version"
    placeholder "$device" && fail "surface '$surface' has no device"
    placeholder "$server" && fail "surface '$surface' has no Jellyfin server version"
    placeholder "$app" && fail "surface '$surface' has no app version (use n/a outside the app)"
    placeholder "$observed" && fail "surface '$surface' has no observation"
    pass "$surface: $verdict"
done

consequence="$(sed -n '/^## Consequence for MVP/,/^## /p' "$doc" | sed '1d; /^## /d' | grep -v -E '^\s*$|TBD' || true)"
[ -n "$consequence" ] || fail "$doc has no Consequence for MVP section with text"
pass "consequence for MVP recorded"
