#!/usr/bin/env bash
# Runs a command that installs packages with apt, such as Playwright's browsers
# with their system libraries, up to three times with a time limit on each
# attempt. GitHub's Ubuntu runners list several apt mirrors in
# /etc/apt/apt-mirrors.txt, but apt moves to the next one only when a mirror
# fails, not when it is slow, so each attempt puts a different mirror first.
# The list is restored afterwards. Without that list the attempts simply repeat.
#
# Usage: scripts/install-browser-deps.sh <command> [argument...]
#   e.g. scripts/install-browser-deps.sh npx playwright install --with-deps webkit
# Environment: ATTEMPT_SECONDS (default 300), APT_MIRRORS_FILE (default
# /etc/apt/apt-mirrors.txt).
set -uo pipefail

[ $# -gt 0 ] || { sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }

attempts=3
limit="${ATTEMPT_SECONDS:-300}"
mirrors="${APT_MIRRORS_FILE:-/etc/apt/apt-mirrors.txt}"
sudo=sudo
[ "$(id -u)" = 0 ] && sudo=

original=""
[ -f "$mirrors" ] && original="$(cat "$mirrors")"
restore() { [ -n "$original" ] && printf '%s\n' "$original" | $sudo tee "$mirrors" >/dev/null; }
trap restore EXIT

# Writes the mirror list starting from its nth mirror (counting from 0),
# renumbering the priorities in the new order.
put_first() {
    local -a urls
    mapfile -t urls < <(printf '%s\n' "$original" | awk 'NF { print $1 }')
    local count=${#urls[@]} i
    for ((i = 0; i < count; i++)); do
        printf '%s\tpriority:%d\n' "${urls[(i + $1) % count]}" $((i + 1))
    done | $sudo tee "$mirrors" >/dev/null
}

for ((attempt = 1; attempt <= attempts; attempt++)); do
    if [ -n "$original" ]; then
        put_first $((attempt - 1))
        echo "Attempt $attempt of $attempts, apt mirrors in order: $(awk '{ printf "%s ", $1 }' "$mirrors")"
    fi
    if timeout --kill-after=15 "$limit" "$@"; then
        exit 0
    fi
    echo "::warning::Browser dependency install attempt $attempt failed or took over $limit seconds"
    # An interrupted apt leaves its lock and half-configured packages behind;
    # what it already downloaded is kept for the next attempt.
    $sudo pkill -x apt-get || true
    $sudo pkill -x dpkg || true
    $sudo dpkg --configure -a || true
done
exit 1
