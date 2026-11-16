#!/usr/bin/env bash
# Runs the server's and the reader's unit tests with coverage and prints a
# summary of each. It reports coverage; it does not fail on a percentage. It
# fails if a test fails or a report is missing.
#
# The browser checks in scripts/smoke-plugin.sh are not measured here; they
# prove the reader's views and flows against a real Jellyfin.
#
# Usage: scripts/coverage.sh
#
# Needs: bash, the .NET 10 SDK, Node.js 24 or later.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

# The server: the built-in Code Coverage collector, as Cobertura. Building the
# plugin also installs and builds the reader.
dotnet test --collect "Code Coverage;Format=cobertura" --results-directory "$out/server"
report="$(find "$out/server" -name '*.cobertura.xml' | head -1)"
[ -n "$report" ] || fail "dotnet test wrote no coverage report"
# The plugin's package only, not the test assembly's.
package="$(grep -o '<package [^>]*name="Jellyfin.Plugin.Oriel"[^>]*>' "$report" || true)"
[ -n "$package" ] || fail "the coverage report has no Jellyfin.Plugin.Oriel package"
rate() { echo "$package" | sed -E "s/.* $1=\"([0-9.]+)\".*/\1/" | awk '{ printf "%.1f%%", $1 * 100 }'; }

# The reader: vitest with the v8 provider, over src/reader/src (vite.config.ts).
(cd src/reader && npx vitest run --coverage --coverage.reportsDirectory="$out/reader")
summary="$out/reader/coverage-summary.json"
[ -f "$summary" ] || fail "vitest wrote no coverage summary"
total() { node -e 'const t = require(process.argv[1]).total; console.log(t[process.argv[2]].pct.toFixed(1) + "%")' "$summary" "$1"; }

echo
echo "Coverage"
echo "  server lines $(rate line-rate), branches $(rate branch-rate)"
echo "  reader lines $(total lines), branches $(total branches), functions $(total functions)"
