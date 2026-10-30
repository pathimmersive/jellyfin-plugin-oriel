#!/usr/bin/env bash
# Remakes the smoke test's Kindle books, oriel-smoke.mobi and oriel-smoke.azw3,
# from EPUBs written by make-epub.mjs, with Calibre's ebook-convert. Nothing in
# Oriel's own toolchain writes these formats, so the books are committed and
# this script only runs when they need changing. Last run with calibre 9.7.0.
#
# Usage: src/reader/e2e/fixtures/make-kindle-books.sh
# Environment: EBOOK_CONVERT, the ebook-convert to run (default: ebook-convert
# on the PATH).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
convert="${EBOOK_CONVERT:-ebook-convert}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
# A path a Windows ebook-convert can read.
hostpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else echo "$1"; fi; }

# The first line of each book's first chapter; the smoke test looks for them.
node "$here/../make-epub.mjs" "$work/mobi.epub" "Oriel smoke MOBI chapter one opens here."
node "$here/../make-epub.mjs" "$work/azw3.epub" "Oriel smoke AZW3 chapter one opens here."

# A MOBI in the old Mobipocket format, and an AZW3 (KF8).
"$convert" "$(hostpath "$work/mobi.epub")" "$(hostpath "$here/oriel-smoke.mobi")" --mobi-file-type old --title "Oriel Smoke MOBI" >/dev/null
"$convert" "$(hostpath "$work/azw3.epub")" "$(hostpath "$here/oriel-smoke.azw3")" --title "Oriel Smoke AZW3" >/dev/null
"$convert" --version | head -1
ls -l "$here"/oriel-smoke.mobi "$here"/oriel-smoke.azw3
