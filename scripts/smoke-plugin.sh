#!/usr/bin/env bash
# Smoke test: build the plugin, load it into a real Jellyfin 12.x container,
# and check what the server reports and serves. Exits non-zero on the first
# failed check and always removes the container.
#
# Needs: bash, curl, docker, the .NET 10 SDK.
# Override the image with JELLYFIN_IMAGE=jellyfin/jellyfin:<tag>.
set -euo pipefail

IMAGE="${JELLYFIN_IMAGE:-jellyfin/jellyfin:12.2.20261005-225228}"
PLUGIN_NAME="Oriel"
PLUGIN_VERSION="0.1.0.0"
ADMIN_USER="smoke"
ADMIN_PW="smoke-$RANDOM$RANDOM"
CLIENT_HEADER='MediaBrowser Client="oriel-smoke", Device="smoke", DeviceId="oriel-smoke", Version="1.0.0"'

repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
container="oriel-smoke-$$"

cleanup() {
    docker rm -f "$container" >/dev/null 2>&1 || true
    rm -rf "$work"
}
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# Docker Desktop on Windows needs a Windows path for bind mounts.
hostpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else echo "$1"; fi; }

# First value of a string field in a JSON body. Enough for the flat
# responses checked here; not a JSON parser.
json_str() { grep -o "\"$1\":\"[^\"]*\"" | head -1 | sed "s/^\"$1\":\"\(.*\)\"$/\1/"; }

# --- build -----------------------------------------------------------------

project="$repo/src/Jellyfin.Plugin.Oriel/Jellyfin.Plugin.Oriel.csproj"
[ -f "$project" ] || fail "plugin project not found at $project"

plugin_dir="$work/plugins/${PLUGIN_NAME}_${PLUGIN_VERSION}"
dotnet publish "$project" -c Release -o "$plugin_dir" --nologo -v quiet \
    || fail "dotnet publish"

[ -f "$plugin_dir/Jellyfin.Plugin.Oriel.dll" ] || fail "plugin assembly missing from publish output"
[ -f "$plugin_dir/meta.json" ] || fail "meta.json missing from publish output"
grep -q '"targetAbi": *"12.0.0.0"' "$plugin_dir/meta.json" || fail "meta.json does not declare targetAbi 12.0.0.0"
pass "meta.json declares targetAbi 12.0.0.0"

bundled="$(cd "$plugin_dir" && ls -1 *.dll \
    | grep -E '^(Jellyfin\.|MediaBrowser\.|Emby\.|Microsoft\.Data\.Sqlite|Microsoft\.EntityFrameworkCore|SQLitePCLRaw)' \
    | grep -v '^Jellyfin\.Plugin\.Oriel\.dll$' || true)"
[ -z "$bundled" ] || fail "publish output bundles host assemblies: $bundled"
pass "publish output bundles no host assemblies"

# --- server ----------------------------------------------------------------

MSYS_NO_PATHCONV=1 docker run -d --name "$container" \
    -p 127.0.0.1::8096 \
    -v "$(hostpath "$plugin_dir"):/config/plugins/${PLUGIN_NAME}_${PLUGIN_VERSION}" \
    "$IMAGE" >/dev/null || fail "docker run $IMAGE"

port="$(docker port "$container" 8096/tcp | head -1 | sed 's/.*://')"
base="http://127.0.0.1:$port"

wait_ready() {
    local url="$1"
    # While starting, the server answers with an HTML holding page, so a
    # status code alone is not enough; wait for the JSON system info.
    for _ in $(seq 1 120); do
        if curl -sf "$url/System/Info/Public" 2>/dev/null | grep -q '"StartupWizardCompleted"'; then
            return 0
        fi
        sleep 1
    done
    docker logs "$container" 2>&1 | tail -40 >&2
    fail "server at $url did not become ready"
}

wait_ready "$base"
pass "server ready on $IMAGE"

# Complete the startup wizard over the API.
post_json() { curl -sf -X POST -H 'Content-Type: application/json' -H "Authorization: $CLIENT_HEADER" "$@"; }
post_json "$base/Startup/Configuration" -d '{"UICulture":"en-US","MetadataCountryCode":"US","PreferredMetadataLanguage":"en"}' >/dev/null || fail "startup configuration"
curl -sf -H "Authorization: $CLIENT_HEADER" "$base/Startup/User" >/dev/null || fail "startup user (get)"
post_json "$base/Startup/User" -d "{\"Name\":\"$ADMIN_USER\",\"Password\":\"$ADMIN_PW\"}" >/dev/null || fail "startup user (set)"
post_json "$base/Startup/RemoteAccess" -d '{"EnableRemoteAccess":true}' >/dev/null || fail "startup remote access"
post_json "$base/Startup/Complete" >/dev/null || fail "startup complete"

auth="$(post_json "$base/Users/AuthenticateByName" -d "{\"Username\":\"$ADMIN_USER\",\"Pw\":\"$ADMIN_PW\"}")" || fail "authenticate"
token="$(echo "$auth" | json_str AccessToken)"
[ -n "$token" ] || fail "no access token in authenticate response"
token_header="$CLIENT_HEADER, Token=\"$token\""
user_id="$(curl -sf -H "Authorization: $token_header" "$base/Users/Me" | json_str Id)"
[ -n "$user_id" ] || fail "no user id from /Users/Me"

get_status() { curl -s -o "$work/body" -w '%{http_code}' "$@"; }

# Plugin loaded and Active.
code="$(get_status -H "Authorization: $token_header" "$base/Plugins")"
[ "$code" = "200" ] || fail "GET /Plugins returned $code"
entry="$(sed 's/},{/}\n{/g' "$work/body" | grep "\"Name\":\"$PLUGIN_NAME\"" || true)"
[ -n "$entry" ] || { docker logs "$container" 2>&1 | grep -i -E 'oriel|plugin' | tail -20 >&2; fail "$PLUGIN_NAME not listed by /Plugins"; }
status="$(echo "$entry" | json_str Status)"
[ "$status" = "Active" ] || fail "$PLUGIN_NAME status is '$status', expected Active"
pass "/Plugins lists $PLUGIN_NAME as Active"

# Reader page and its assets, served anonymously at a prefix.
check_reader() {
    local prefix="$1"
    local headers="$work/headers"
    code="$(curl -s -D "$headers" -o "$work/page" -w '%{http_code}' "$prefix/Oriel/")"
    [ "$code" = "200" ] || fail "anonymous GET $prefix/Oriel/ returned $code"
    grep -i -q '^content-type: *text/html' "$headers" || fail "GET $prefix/Oriel/ is not text/html"

    refs="$(grep -o -E '(src|href)="[^"]*"' "$work/page" | sed -E 's/^(src|href)="(.*)"$/\2/')"
    [ -n "$refs" ] || fail "reader page references no assets"
    for ref in $refs; do
        case "$ref" in
            /*|*://*) fail "reader page asset reference '$ref' is not relative" ;;
        esac
        code="$(curl -s -o /dev/null -w '%{http_code}' "$prefix/Oriel/$ref")"
        [ "$code" = "200" ] || fail "anonymous GET $prefix/Oriel/$ref returned $code"
    done
    pass "anonymous GET $prefix/Oriel/ is 200 text/html with relative assets that resolve"
}

check_reader "$base"

code="$(get_status "$base/Oriel/Me")"
[ "$code" = "401" ] || fail "GET /Oriel/Me without a token returned $code, expected 401"
code="$(get_status -H "Authorization: $token_header" "$base/Oriel/Me")"
[ "$code" = "200" ] || fail "GET /Oriel/Me with a token returned $code"
grep -q "$user_id" "$work/body" || fail "GET /Oriel/Me body does not carry user id $user_id: $(cat "$work/body")"
pass "/Oriel/Me is 401 without a token and returns the user id with one"

# Second pass with a BaseUrl.
code="$(get_status -H "Authorization: $token_header" "$base/System/Configuration/network")"
[ "$code" = "200" ] || fail "GET network configuration returned $code"
sed 's/"BaseUrl":"[^"]*"/"BaseUrl":"\/jf"/' "$work/body" > "$work/network.json"
grep -q '"BaseUrl":"/jf"' "$work/network.json" || fail "could not set BaseUrl in network configuration"
curl -sf -X POST -H 'Content-Type: application/json' -H "Authorization: $token_header" \
    --data-binary "@$work/network.json" "$base/System/Configuration/network" >/dev/null || fail "POST network configuration"
docker restart "$container" >/dev/null || fail "docker restart"

port="$(docker port "$container" 8096/tcp | head -1 | sed 's/.*://')"
wait_ready "http://127.0.0.1:$port/jf"
check_reader "http://127.0.0.1:$port/jf"

echo "smoke-plugin: all checks passed"
