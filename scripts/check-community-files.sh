#!/usr/bin/env bash
# Checks that the repository carries its community files and that
# THIRD_PARTY_NOTICES.md has an entry for everything vendored into the reader.
# Also checks the issue forms and their required fields, the issue chooser's
# links to Discussions and private security reports, that contributions are
# asked for a CHANGELOG.md line, and that releases take their notes from it.
#
# Usage: scripts/check-community-files.sh
#
# A vendored package is a folder under src/reader/vendor with a LICENSE file;
# a bundled library is a .js file or a folder under src/reader/vendor/*/vendor,
# such as foliate-js's zip.js and fflate, whose minified copies carry no notice
# of their own, and its pdfjs folder. Each needs a "## " heading in the notices
# that names it, as does WordNet, the dictionary the plugin embeds.
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

# Issue forms: each field whose id is listed must be marked required.
forms=.github/ISSUE_TEMPLATE
check_form() {
    local form="$forms/$1" label="$2"
    shift 2
    if [ ! -s "$form" ]; then fail "$form is missing"; return; fi
    if grep -q -E "^labels: \[\"?$label\"?\]" "$form"; then pass "$form applies the label $label"
    else fail "$form does not apply the label $label"; fi
    for id in "$@"; do
        # The field's block runs from its "id:" line to the next "- type:" line.
        if awk -v id="$id" '
            /^  - type:/ { inside = 0 }
            $0 ~ "^    id: " id "$" { inside = 1; found = 1 }
            inside && /^      required: true$/ { required = 1 }
            END { exit !(found && required) }' "$form"; then
            pass "$form requires $id"
        else
            fail "$form has no required field $id"
        fi
    done
}
check_form bug_report.yml bug jellyfin-version oriel-version client book-format steps what-happened
check_form feature_request.yml enhancement what why
if ls "$forms"/*.md >/dev/null 2>&1; then
    fail "$forms still has markdown templates: $(cd "$forms" && echo *.md)"
else
    pass "$forms has no markdown templates"
fi
chooser="$forms/config.yml"
if [ -f "$chooser" ] && grep -q -E '^blank_issues_enabled: false' "$chooser"; then pass "blank issues are off"
else fail "$chooser does not turn blank issues off"; fi
for link in '/discussions' '/security/advisories/new'; do
    if [ -f "$chooser" ] && grep -q -E "url: https://github\\.com/[^/]+/[^/]+$link\$" "$chooser"; then
        pass "the issue chooser links $link"
    else
        fail "the issue chooser has no contact link to $link"
    fi
done

# Contributions record their changes in CHANGELOG.md.
if grep -q 'CHANGELOG.md' .github/pull_request_template.md 2>/dev/null; then pass "the pull request template asks for a CHANGELOG.md line"
else fail "the pull request template does not ask for a CHANGELOG.md line"; fi
for route in CHANGELOG.md /discussions SECURITY.md; do
    if grep -q -F "$route" CONTRIBUTING.md 2>/dev/null; then pass "CONTRIBUTING.md names $route"
    else fail "CONTRIBUTING.md does not name $route"; fi
done

if [ -f README.md ]; then
    if grep -q -i 'unofficial' README.md; then
        pass "README.md says the plugin is unofficial"
    else
        fail "README.md does not say the plugin is unofficial"
    fi
fi

if [ -f CHANGELOG.md ] && grep -q -E '^## \[Unreleased\]' CHANGELOG.md; then
    pass "CHANGELOG.md has an [Unreleased] section"
else
    fail "CHANGELOG.md is missing or has no '## [Unreleased]' section"
fi
release=.github/workflows/release.yml
if grep -q -E 'gh release create .*--notes-file dist/notes\.md' "$release" && ! grep -q -e '--generate-notes' "$release" \
    && grep -q -E '^ +dist/notes\.md$' "$release"; then
    pass "the GitHub release notes are the version's CHANGELOG.md section"
else
    fail "$release does not upload dist/notes.md and create the release with --notes-file dist/notes.md"
fi
if [ -f README.md ] && grep -q -E '^## FAQ and troubleshooting' README.md; then
    pass "README.md has an FAQ and troubleshooting section"
else
    fail "README.md has no '## FAQ and troubleshooting' section"
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

if [ -e src/Jellyfin.Plugin.Oriel/Data/wordnet.txt.gz ]; then
    if has_entry WordNet; then pass "notice for WordNet (src/Jellyfin.Plugin.Oriel/Data/wordnet.txt.gz)"
    else fail "no '## ' entry for WordNet in $notices"; fi
fi

if [ "$missing" -gt 0 ]; then
    echo "check-community-files: $missing missing" >&2
    exit 1
fi
echo "check-community-files: all present"
