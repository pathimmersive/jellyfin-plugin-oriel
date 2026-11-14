#!/usr/bin/env bash
# Checks scripts/package-plugin.py on its own: the zip holds only the plugin
# assembly, meta.json and the image meta.json names, at the requested version;
# the image is written beside the zip and named as the manifest's imageUrl; the manifest entry matches
# meta.json and the zip's MD5, a later release keeps the earlier versions, and a
# repeated version or a malformed version fails without writing anything.
#
# Needs: bash, Python 3, the .NET 10 SDK, Node and npm (the plugin build runs the
# reader build).
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

py="$(command -v python3 || command -v python || true)"
[ -n "$py" ] || fail "Python 3 is needed"
package() { "$py" "$repo/scripts/package-plugin.py" "$@"; }
url="https://example.invalid/oriel/releases/download"

# A malformed version is refused before anything is built or written.
if package --version 1.2 --out "$work/bad" --url-base "$url" >/dev/null 2>&1; then
    fail "packaging accepted the malformed version 1.2"
fi
[ ! -e "$work/bad" ] || fail "a refused version still wrote $work/bad"
pass "a malformed version is refused and writes nothing"

package --version 0.9.0 --out "$work/first" --url-base "$url" --changelog "First test release." \
    || fail "packaging 0.9.0"
"$py" - "$work/first" "$url" <<'EOF' || fail "the 0.9.0 package is not as expected"
import hashlib, json, sys, zipfile
out, url = sys.argv[1], sys.argv[2]
zip_path = f"{out}/oriel_0.9.0.0.zip"
with zipfile.ZipFile(zip_path) as z:
    names = sorted(z.namelist())
    assert names == ["Jellyfin.Plugin.Oriel.dll", "meta.json", "oriel.png"], f"zip holds {names}"
    meta = json.loads(z.read("meta.json"))
    image = z.read("oriel.png")
assert meta["imagePath"] == "oriel.png", f"meta.json imagePath {meta.get('imagePath')!r}"
assert image[:4] == b"\x89PNG", "oriel.png in the zip is not a PNG"
assert open(f"{out}/oriel.png", "rb").read() == image, "the image beside the zip differs from the one in it"
assert meta["version"] == "0.9.0.0", f"meta.json version {meta['version']}"
assert meta["targetAbi"] == "12.2.0.0", f"meta.json targetAbi {meta['targetAbi']}"
manifest = json.load(open(f"{out}/manifest.json", encoding="utf-8"))
assert len(manifest) == 1, f"{len(manifest)} plugins in the manifest"
plugin = manifest[0]
for key in ["guid", "name", "description", "overview", "owner", "category"]:
    assert plugin[key] == meta[key], f"manifest {key} {plugin[key]!r} differs from meta.json {meta[key]!r}"
assert plugin["imageUrl"] == f"{url}/v0.9.0/oriel.png", plugin.get("imageUrl")
assert len(plugin["versions"]) == 1, f"{len(plugin['versions'])} versions"
version = plugin["versions"][0]
assert version["version"] == "0.9.0.0", version["version"]
assert version["targetAbi"] == "12.2.0.0", version["targetAbi"]
assert version["sourceUrl"] == f"{url}/v0.9.0/oriel_0.9.0.0.zip", version["sourceUrl"]
assert version["checksum"] == hashlib.md5(open(zip_path, "rb").read()).hexdigest(), "checksum is not the zip's MD5"
sha256 = open(zip_path + ".sha256", encoding="utf-8").read()
assert sha256 == f"{hashlib.sha256(open(zip_path, 'rb').read()).hexdigest()}  oriel_0.9.0.0.zip\n", f"the .sha256 file reads {sha256!r}"
assert version["changelog"] == "First test release.", version["changelog"]
assert version["timestamp"].endswith("Z"), version["timestamp"]
EOF
pass "the zip holds only the plugin assembly, meta.json and its image at 0.9.0.0; the image is the manifest's imageUrl; the manifest matches meta.json and the zip's MD5; the .sha256 file holds the zip's SHA-256 and name"

package --version 0.9.1 --out "$work/second" --url-base "$url" --manifest "$work/first/manifest.json" \
    || fail "packaging 0.9.1 on top of 0.9.0"
"$py" - "$work/second/manifest.json" <<'EOF' || fail "the manifest after 0.9.1 is not as expected"
import json, sys
plugin = json.load(open(sys.argv[1], encoding="utf-8"))[0]
versions = [v["version"] for v in plugin["versions"]]
assert versions == ["0.9.1.0", "0.9.0.0"], f"versions {versions}"
assert plugin["imageUrl"].endswith("/v0.9.1/oriel.png"), plugin["imageUrl"]
EOF
pass "a later release keeps the earlier versions, newest first, and names its own image"

if package --version 0.9.1 --out "$work/again" --url-base "$url" --manifest "$work/second/manifest.json" >/dev/null 2>&1; then
    fail "packaging accepted 0.9.1 a second time"
fi
[ ! -e "$work/again/manifest.json" ] || fail "a refused repeat still wrote a manifest"
pass "a version already in the manifest is refused and writes nothing"

# The release's section of CHANGELOG.md is the manifest's changelog text, and a
# version with no section is refused before anything is written.
cat > "$work/CHANGELOG.md" <<'EOF'
# Changelog

## [Unreleased]

- Something not yet released.

## [0.9.2] - 2026-11-14

### Added

- A test feature.

## [0.9.1] - 2026-11-01

- An older note.
EOF
package --version 0.9.2 --out "$work/notes" --url-base "$url" --changelog-file "$work/CHANGELOG.md"     || fail "packaging 0.9.2 with its changelog section"
"$py" - "$work/notes/manifest.json" <<'EOF' || fail "the manifest's changelog is not the 0.9.2 section"
import json, sys
version = json.load(open(sys.argv[1], encoding="utf-8"))[0]["versions"][0]
assert version["changelog"] == "### Added\n\n- A test feature.", repr(version["changelog"])
EOF
if package --version 0.9.3 --out "$work/nonotes" --url-base "$url" --changelog-file "$work/CHANGELOG.md" >/dev/null 2>&1; then
    fail "packaging accepted 0.9.3, which has no section in the changelog"
fi
[ ! -e "$work/nonotes" ] || fail "a version without a changelog section still wrote output"
pass "a version's CHANGELOG.md section is the manifest's changelog text, and a version with no section is refused before anything is written"

echo "test-package: all checks passed"
