#!/usr/bin/env bash
# Checks that the repository carries its community files and that
# THIRD_PARTY_NOTICES.md has an entry for everything vendored into the reader.
#
# Usage: scripts/check-community-files.sh
#
# A vendored package is a folder under src/reader/vendor with a LICENSE file;
# a bundled library is a .js file or a folder under src/reader/vendor/*/vendor,
# such as foliate-js's zip.js and fflate, whose minified copies carry no notice
# of their own, and its pdfjs folder. Each needs a "## " heading in the notices
# that names it.
# Exits non-zero listing everything missing.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo"
missing=0

fail() { echo "FAIL: $*" >&2; missing=$((missing + 1)); }
pass() { echo "PASS: $*"; }

for file in README.md LICENSE CONTRIBUTING.md CODE_OF_CONDUCT.md SECURITY.md THIRD_PARTY_NOTICES.md \
    .github/pull_request_template.md; do
    if [ -s "$file" ]; then pass "$file"; else fail "$file is missing or empty"; fi
done
if ls .github/ISSUE_TEMPLATE/*.md >/dev/null 2>&1; then
    pass ".github/ISSUE_TEMPLATE has an issue template"
else
    fail ".github/ISSUE_TEMPLATE has no issue template"
fi

if [ -f README.md ]; then
    if grep -q -i 'unofficial' README.md; then
        pass "README.md says the plugin is unofficial"
    else
        fail "README.md does not say the plugin is unofficial"
    fi
fi

notices="THIRD_PARTY_NOTICES.md"
has_entry() { [ -f "$notices" ] && grep -q -i -E "^## .*\\b$1\\b" "$notices"; }

for license in src/reader/vendor/*/LICENSE; do
    [ -e "$license" ] || continue
    name="$(basename "$(dirname "$license")")"
    if has_entry "$name"; then pass "notice for $name"; else fail "no '## ' entry for $name in $notices"; fi
done
for lib in src/reader/vendor/*/vendor/*.js src/reader/vendor/*/vendor/*/; do
    [ -e "$lib" ] || continue
    name="$(basename "$lib" .js)"
    if has_entry "$name"; then pass "notice for $name (bundled in $(basename "$(dirname "$(dirname "$lib")")"))"
    else fail "no '## ' entry for $name ($lib) in $notices"; fi
done

if [ "$missing" -gt 0 ]; then
    echo "check-community-files: $missing missing" >&2
    exit 1
fi
echo "check-community-files: all present"
