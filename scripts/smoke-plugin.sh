#!/usr/bin/env bash
# Smoke test: build the plugin, load it into a real Jellyfin 12.x container,
# and check what the server reports and serves. Exits non-zero on the first
# failed check and always removes the container.
#
# Needs: bash, curl, docker, Node and npm, the .NET 10 SDK.
# Override the image with JELLYFIN_IMAGE=jellyfin/jellyfin:<tag>. The plugin is
# built against the Jellyfin version in the tag; JELLYFIN_VERSION overrides it.
set -euo pipefail

IMAGE="${JELLYFIN_IMAGE:-jellyfin/jellyfin:12.2.20261005-225228}"
PLUGIN_NAME="Oriel"
PLUGIN_VERSION="0.1.0.0"
ADMIN_USER="smoke"
ADMIN_PW="smoke-$RANDOM$RANDOM"
CLIENT_HEADER='MediaBrowser Client="oriel-smoke", Device="smoke", DeviceId="oriel-smoke", Version="1.0.0"'
BOOK_TEXT="Oriel smoke chapter one opens here."
PLUGIN_ID="2c488ea7-0cae-4499-a2a7-6bae27b4e8f6"

repo="$(cd "$(dirname "$0")/.." && pwd)"
. "$repo/scripts/file-transformation.sh"
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

# The Jellyfin version the image runs: the tag's major.minor, and its patch
# unless that field is a build date (12.2.20261005-225228 is 12.2.0). The
# plugin is built against it, or against JELLYFIN_VERSION when that is set.
tag="${IMAGE##*:}"
image_version=""
if [[ "$tag" =~ ^([0-9]+)\.([0-9]+)(\.([0-9]+))? ]]; then
    patch="${BASH_REMATCH[4]:-0}"
    [ "${#patch}" -lt 8 ] || patch=0
    image_version="${BASH_REMATCH[1]}.${BASH_REMATCH[2]}.$patch"
fi
JELLYFIN_VERSION="${JELLYFIN_VERSION:-$image_version}"
[ -n "$JELLYFIN_VERSION" ] || fail "cannot read a Jellyfin version from image tag '$tag'; set JELLYFIN_VERSION"

plugin_dir="$work/plugins/${PLUGIN_NAME}_${PLUGIN_VERSION}"
dotnet publish "$project" -c Release -o "$plugin_dir" --nologo -v quiet -p:JellyfinVersion="$JELLYFIN_VERSION" \
    || fail "dotnet publish"

# A plugin built against a newer Jellyfin than the server is refused as NotSupported.
assets="$(dirname "$project")/obj/project.assets.json"
built="$(grep -o '"Jellyfin\.Controller/[^"]*"' "$assets" | head -1 | sed 's/^"Jellyfin\.Controller\/\(.*\)"$/\1/' || true)"
[ "$built" = "$JELLYFIN_VERSION" ] || fail "plugin built against Jellyfin.Controller '$built', expected $JELLYFIN_VERSION"
[ -z "$image_version" ] || [ "$built" = "$image_version" ] \
    || fail "plugin built against Jellyfin.Controller $built, but $IMAGE runs $image_version"
pass "plugin built against Jellyfin.Controller $built for $IMAGE"

[ -f "$plugin_dir/Jellyfin.Plugin.Oriel.dll" ] || fail "plugin assembly missing from publish output"
[ -f "$plugin_dir/meta.json" ] || fail "meta.json missing from publish output"
grep -q '"targetAbi": *"12.0.0.0"' "$plugin_dir/meta.json" || fail "meta.json does not declare targetAbi 12.0.0.0"
pass "meta.json declares targetAbi 12.0.0.0"

bundled="$(cd "$plugin_dir" && ls -1 *.dll \
    | grep -E '^(Jellyfin\.|MediaBrowser\.|Emby\.|Microsoft\.Data\.Sqlite|Microsoft\.EntityFrameworkCore|SQLitePCLRaw)' \
    | grep -v '^Jellyfin\.Plugin\.Oriel\.dll$' || true)"
[ -z "$bundled" ] || fail "publish output bundles host assemblies: $bundled"
pass "publish output bundles no host assemblies"

# --- book and browser ------------------------------------------------------

reader="$repo/src/reader"
mkdir -p "$work/media/books"
node "$reader/e2e/make-epub.mjs" "$work/media/books/oriel-smoke.epub" "$BOOK_TEXT" || fail "generate test EPUB"
# A comic with an upper-case extension, as some libraries have.
node "$reader/e2e/make-cbz.mjs" "$work/media/books/oriel-smoke-comic.CBZ" || fail "generate test CBZ"
# Kindle books, made with Calibre by e2e/fixtures/make-kindle-books.sh.
cp "$reader/e2e/fixtures/oriel-smoke.mobi" "$reader/e2e/fixtures/oriel-smoke.azw3" "$work/media/books/" || fail "copy the test Kindle books"
MOBI_TEXT="Oriel smoke MOBI chapter one opens here."
AZW3_TEXT="Oriel smoke AZW3 chapter one opens here."
PDF_TEXT="Oriel smoke PDF page one opens here."
node "$reader/e2e/make-pdf.mjs" "$work/media/books/oriel-smoke.pdf" "$PDF_TEXT" || fail "generate test PDF"
(cd "$reader" && npx playwright install webkit chromium >/dev/null) || fail "install Playwright WebKit and Chromium"

fetch_file_transformation "$work/ft" || fail "fetch File Transformation $FT_VERSION"

# --- server ----------------------------------------------------------------

MSYS_NO_PATHCONV=1 docker run -d --name "$container" \
    -p 127.0.0.1::8096 \
    -v "$(hostpath "$plugin_dir"):/config/plugins/${PLUGIN_NAME}_${PLUGIN_VERSION}" \
    -v "$(hostpath "$work/media/books"):/media/books:ro" \
    -v "$(hostpath "$work/ft"):/oriel-ft:ro" \
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
server_id="$(curl -sf "$base/System/Info/Public" | json_str Id)"
[ -n "$server_id" ] || fail "no server id from /System/Info/Public"

get_status() { curl -s -o "$work/body" -w '%{http_code}' "$@"; }

# A books library holding the generated EPUB.
code="$(get_status -X POST -H 'Content-Type: application/json' -H "Authorization: $token_header" \
    -d '{"LibraryOptions":{}}' \
    "$base/Library/VirtualFolders?name=Books&collectionType=books&paths=%2Fmedia%2Fbooks&refreshLibrary=true")"
[ "$code" = "204" ] || fail "creating the books library returned $code"
# The id of the listed book whose file ends with the given extension, in any
# case, or nothing.
book_id() {
    node -e 'let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
        const ext = process.argv[1].toLowerCase()
        let items = []
        try { items = JSON.parse(s).Items ?? [] } catch {}
        const book = items.find(i => (i.Path ?? "").toLowerCase().endsWith(ext))
        if (book) console.log(book.Id)
    })' "$1"
}
# A library added while the startup scan is still running is left out of that
# scan, and its own refresh is dropped, so ask for another scan every 10 s.
item_id="" cbz_id="" mobi_id="" azw3_id="" pdf_id=""
for i in $(seq 1 60); do
    if [ $((i % 10)) = 0 ]; then
        curl -sf -X POST -H "Authorization: $token_header" "$base/Library/Refresh" >/dev/null || true
    fi
    books="$(curl -sf -H "Authorization: $token_header" \
        "$base/Items?userId=$user_id&Recursive=true&IncludeItemTypes=Book&Fields=Path" || true)"
    item_id="$(book_id .epub <<< "$books")"
    cbz_id="$(book_id .cbz <<< "$books")"
    mobi_id="$(book_id .mobi <<< "$books")"
    azw3_id="$(book_id .azw3 <<< "$books")"
    pdf_id="$(book_id .pdf <<< "$books")"
    [ -n "$item_id" ] && [ -n "$cbz_id" ] && [ -n "$mobi_id" ] && [ -n "$azw3_id" ] && [ -n "$pdf_id" ] && break
    sleep 1
done
if [ -z "$item_id" ] || [ -z "$cbz_id" ] || [ -z "$mobi_id" ] || [ -z "$azw3_id" ] || [ -z "$pdf_id" ]; then
    docker logs "$container" 2>&1 | tail -60 >&2
    echo "INFO: the books library lists: $(grep -o '"Path":"[^"]*"' <<< "$books" | tr '\n' ' ')" >&2
    fail "the books library does not list all of the test EPUB ($item_id), comic ($cbz_id), MOBI ($mobi_id), AZW3 ($azw3_id) and PDF ($pdf_id)"
fi
pass "books library lists the test EPUB as $item_id, the comic as $cbz_id, the MOBI as $mobi_id, the AZW3 as $azw3_id and the PDF as $pdf_id"

# The reader in WebKit: renders the book, reports an unknown item, and sends
# a signed-out visitor to the login page.
check_reader_in_browser() {
    ORIEL_BASE="$1" ORIEL_SERVER_ID="$server_id" ORIEL_USER_ID="$user_id" ORIEL_TOKEN="$token" \
    ORIEL_ITEM_ID="$item_id" ORIEL_EXPECT_TEXT="$BOOK_TEXT" ORIEL_MISSING_ID="00000000000040008000000000000000" \
        node "$reader/e2e/reader.e2e.mjs" || fail "reader in WebKit at $1"
}

# One-finger drags in the reader on an iPhone-sized WebKit page: they leave the
# page still while text is selected and turn it when nothing is.
check_selection_in_browser() {
    ORIEL_BASE="$1" ORIEL_SERVER_ID="$server_id" ORIEL_USER_ID="$user_id" ORIEL_TOKEN="$token" ORIEL_ITEM_ID="$item_id" \
        node "$reader/e2e/selection.e2e.mjs" || fail "selection drag in WebKit at $1"
}

# Keys, edge clicks, the mouse wheel and a trackpad swipe turn pages on a
# desktop-sized page, in WebKit and in Chromium.
check_desktop_input_in_browser() {
    local browser
    for browser in webkit chromium; do
        ORIEL_BASE="$1" ORIEL_SERVER_ID="$server_id" ORIEL_USER_ID="$user_id" ORIEL_TOKEN="$token" ORIEL_ITEM_ID="$item_id" \
        ORIEL_BROWSER="$browser" node "$reader/e2e/desktop-input.e2e.mjs" || fail "desktop page turns in $browser at $1"
    done
}

# The reader's controls: in WebKit at iPhone size with touch and in Chromium at
# desktop size with a mouse.
check_controls_in_browser() {
    local browser
    for browser in webkit chromium; do
        ORIEL_BASE="$1" ORIEL_SERVER_ID="$server_id" ORIEL_USER_ID="$user_id" ORIEL_TOKEN="$token" ORIEL_ITEM_ID="$item_id" \
        ORIEL_BROWSER="$browser" node "$reader/e2e/controls.e2e.mjs" || fail "the reader's controls in $browser at $1"
    done
}

# Contents, on the test EPUB, comic and PDF, in WebKit at iPhone size and in
# Chromium at desktop size.
check_contents_in_browser() {
    local browser
    for browser in webkit chromium; do
        ORIEL_BASE="$1" ORIEL_SERVER_ID="$server_id" ORIEL_USER_ID="$user_id" ORIEL_TOKEN="$token" ORIEL_ITEM_ID="$item_id" \
        ORIEL_CBZ_ID="$cbz_id" ORIEL_PDF_ID="$pdf_id" ORIEL_BROWSER="$browser" node "$reader/e2e/contents.e2e.mjs" || fail "Contents in $browser at $1"
    done
}

# A plugin is loaded and Active.
check_plugin_active() {
    local prefix="$1" name="$2"
    code="$(get_status -H "Authorization: $token_header" "$prefix/Plugins")"
    [ "$code" = "200" ] || fail "GET /Plugins returned $code"
    entry="$(sed 's/},{/}\n{/g' "$work/body" | grep "\"Name\":\"$name\"" || true)"
    [ -n "$entry" ] || { docker logs "$container" 2>&1 | grep -i -E 'oriel|plugin|transformation' | tail -20 >&2; fail "$name not listed by /Plugins"; }
    status="$(echo "$entry" | json_str Status)"
    [ "$status" = "Active" ] || fail "$name status is '$status', expected Active"
    pass "/Plugins lists $name as Active"
}

check_plugin_active "$base" "$PLUGIN_NAME"

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
        code="$(curl -s -D "$headers" -o /dev/null -w '%{http_code}' "$prefix/Oriel/$ref")"
        [ "$code" = "200" ] || fail "anonymous GET $prefix/Oriel/$ref returned $code"
        case "$ref" in
            *.js) grep -i -q '^content-type: *text/javascript' "$headers" || fail "GET $prefix/Oriel/$ref is not text/javascript" ;;
            *.css) grep -i -q '^content-type: *text/css' "$headers" || fail "GET $prefix/Oriel/$ref is not text/css" ;;
        esac
    done
    code="$(curl -s -o /dev/null -w '%{http_code}' "$prefix/Oriel/assets/missing.js")"
    [ "$code" = "404" ] || fail "GET $prefix/Oriel/assets/missing.js returned $code, expected 404"
    pass "anonymous GET $prefix/Oriel/ is 200 text/html with relative assets that resolve with their content types; unknown assets are 404"
}

check_reader "$base"
check_reader_in_browser "$base"
# The reader check above turned pages, which saves the position; the selection
# check expects the book to open at its start.
curl -sf -o /dev/null -X POST -H 'Content-Type: application/json' -H "Authorization: $token_header" \
    -d '{"PlaybackPositionTicks":0}' "$base/UserItems/$item_id/UserData?userId=$user_id" \
    || fail "could not clear the saved position before the selection check"
check_selection_in_browser "$base"
check_desktop_input_in_browser "$base"

code="$(get_status "$base/Oriel/Me")"
[ "$code" = "401" ] || fail "GET /Oriel/Me without a token returned $code, expected 401"
code="$(get_status -H "Authorization: $token_header" "$base/Oriel/Me")"
[ "$code" = "200" ] || fail "GET /Oriel/Me with a token returned $code"
grep -q "$user_id" "$work/body" || fail "GET /Oriel/Me body does not carry user id $user_id: $(cat "$work/body")"
pass "/Oriel/Me is 401 without a token and returns the user id with one"

# --- progress in Jellyfin's user data --------------------------------------

# Runs before anything opens the book in jellyfin-web's own book player. The
# library scan gives every book a runtime of 10^7 ticks, the one-second
# timeline that player reports on, so a position is round(fraction x 10^7)
# ticks. 0.6 of the way through the test EPUB is in its third chapter.
BOOK_RUNTIME_TICKS=10000000
PROGRESS_TICKS=6000000
PROGRESS_TEXT="Oriel smoke chapter three starts here."

# First value of a number or boolean field in a JSON body, or nothing.
json_val() { grep -o "\"$1\":[^,}]*" | head -1 | sed "s/^\"$1\"://" || true; }

resume_lists_book() {
    local query="$1"
    code="$(get_status -H "Authorization: $token_header" "$base/UserItems/Resume?userId=$user_id&$query")"
    [ "$code" = "200" ] || fail "GET /UserItems/Resume?$query returned $code"
    grep -q "\"Id\":\"$item_id\"" "$work/body"
}

# Writes Jellyfin user data as another app would after reading just now: the
# body plus LastPlayedDate set to the current time, which is what makes it
# newer than a position Oriel stored earlier.
write_user_data() {
    local body="${1%\}},\"LastPlayedDate\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\"}"
    code="$(get_status -X POST -H 'Content-Type: application/json' -H "Authorization: $token_header" \
        -d "$body" "${2:-$base}/UserItems/${3:-$item_id}/UserData?userId=$user_id")"
    [ "$code" = "200" ] || fail "POST /UserItems/${3:-$item_id}/UserData $1 returned $code"
}

show_user_data() {
    code="$(get_status -H "Authorization: $token_header" "$base/UserItems/$item_id/UserData?userId=$user_id")"
    [ "$code" = "200" ] || fail "GET /UserItems/$item_id/UserData returned $code"
    echo "INFO: after writing $1 the server returns PlaybackPositionTicks=$(json_val PlaybackPositionTicks < "$work/body")" \
        "PlayedPercentage=$(json_val PlayedPercentage < "$work/body") Played=$(json_val Played < "$work/body")"
}

code="$(get_status -H "Authorization: $token_header" "$base/Items/$item_id?userId=$user_id")"
[ "$code" = "200" ] || fail "GET /Items/$item_id returned $code"
runtime="$(json_val RunTimeTicks < "$work/body")"
[ "$runtime" = "$BOOK_RUNTIME_TICKS" ] || fail "the test EPUB has RunTimeTicks='$runtime', expected $BOOK_RUNTIME_TICKS"
# The reader checks above turned pages in Oriel, which saves the position, so
# start from no saved position.
write_user_data '{"PlaybackPositionTicks":0}'
for query in mediaTypes=Book includeItemTypes=Book; do
    ! resume_lists_book "$query" || fail "/UserItems/Resume?$query lists the test EPUB with no position saved"
done
pass "the library scan gives the test EPUB RunTimeTicks=$BOOK_RUNTIME_TICKS and /UserItems/Resume does not list it with no position saved"

write_user_data "{\"PlaybackPositionTicks\":$PROGRESS_TICKS}"
show_user_data "PlaybackPositionTicks=$PROGRESS_TICKS"
[ "$(json_val PlaybackPositionTicks < "$work/body")" = "$PROGRESS_TICKS" ] \
    || fail "the server did not keep PlaybackPositionTicks=$PROGRESS_TICKS"
for query in mediaTypes=Book includeItemTypes=Book; do
    resume_lists_book "$query" || fail "/UserItems/Resume?$query does not list the test EPUB after PlaybackPositionTicks=$PROGRESS_TICKS was written"
done
pass "after PlaybackPositionTicks=$PROGRESS_TICKS is written through /UserItems/{id}/UserData, /UserItems/Resume lists the test EPUB"

write_user_data "{\"PlaybackPositionTicks\":$PROGRESS_TICKS,\"PlayedPercentage\":60}"
show_user_data "PlaybackPositionTicks=$PROGRESS_TICKS and PlayedPercentage=60"

ORIEL_BASE="$base" ORIEL_SERVER_ID="$server_id" ORIEL_USER_ID="$user_id" ORIEL_TOKEN="$token" \
ORIEL_ITEM_ID="$item_id" ORIEL_EXPECT_TEXT="$PROGRESS_TEXT" \
    node "$reader/e2e/progress.e2e.mjs" || fail "jellyfin-web with saved progress at $base"

# Oriel opens at the saved position and writes it back as pages turn. The
# built-in player may have saved its own position, so save 0.6 again first,
# and again afterwards for the checks that follow.
write_user_data "{\"PlaybackPositionTicks\":$PROGRESS_TICKS}"
ORIEL_BASE="$base" ORIEL_SERVER_ID="$server_id" ORIEL_USER_ID="$user_id" ORIEL_TOKEN="$token" \
ORIEL_ITEM_ID="$item_id" ORIEL_SAVED_TICKS="$PROGRESS_TICKS" ORIEL_EXPECT_TEXT="$PROGRESS_TEXT" \
    node "$reader/e2e/position.e2e.mjs" || fail "Oriel did not open at or save the reading position at $base"
write_user_data "{\"PlaybackPositionTicks\":$PROGRESS_TICKS}"

# --- exact positions in the plugin's store -----------------------------------

POSITION_CFI="epubcfi(/6/8!/4/2/1:0)"
POSITION_FRACTION="0.6"

# Creates a user with a password and returns "<user id> <token header>".
make_user() {
    local name="$1" password="$2" id auth user_token
    code="$(get_status -X POST -H 'Content-Type: application/json' -H "Authorization: $token_header" \
        -d "{\"Name\":\"$name\",\"Password\":\"$password\"}" "$base/Users/New")"
    [ "$code" = "200" ] || fail "creating user $name returned $code"
    id="$(json_str Id < "$work/body")"
    auth="$(post_json "$base/Users/AuthenticateByName" -d "{\"Username\":\"$name\",\"Pw\":\"$password\"}")" \
        || fail "authenticate as $name"
    user_token="$(echo "$auth" | json_str AccessToken)"
    [ -n "$id" ] && [ -n "$user_token" ] || fail "no id or token for user $name"
    echo "$id $CLIENT_HEADER, Token=\"$user_token\""
}

position_status() { get_status "$@" "$base/Oriel/Positions/$item_id"; }
put_position() {
    get_status -X PUT -H 'Content-Type: application/json' -H "Authorization: $1" -d "$2" "$base/Oriel/Positions/${3:-$item_id}"
}

# The reader checks above already stored positions for this user; a user with
# nothing stored is checked below.
code="$(put_position "$token_header" "{\"cfi\":\"$POSITION_CFI\",\"fraction\":$POSITION_FRACTION}")"
[ "$code" = "200" ] && [ -n "$(json_str savedAt < "$work/body")" ] || fail "PUT /Oriel/Positions/$item_id returned $code, expected 200 with the saved position: $(cat "$work/body")"
code="$(position_status -H "Authorization: $token_header")"
[ "$code" = "200" ] || fail "GET /Oriel/Positions/$item_id after saving returned $code"
[ "$(json_str cfi < "$work/body")" = "$POSITION_CFI" ] || fail "the stored position is not the saved CFI: $(cat "$work/body")"
[ "$(json_val fraction < "$work/body")" = "$POSITION_FRACTION" ] || fail "the stored fraction is not $POSITION_FRACTION: $(cat "$work/body")"
[ -n "$(json_str savedAt < "$work/body")" ] || fail "the stored position has no savedAt time: $(cat "$work/body")"
pass "PUT then GET /Oriel/Positions/{id} stores and returns the exact position with its time"

code="$(put_position "$token_header" '{"cfi":"","fraction":0.5}')"
[ "$code" = "400" ] || fail "PUT with an empty CFI returned $code, expected 400"
code="$(put_position "$token_header" "{\"cfi\":\"$POSITION_CFI\",\"fraction\":1.5}")"
[ "$code" = "400" ] || fail "PUT with fraction 1.5 returned $code, expected 400"
code="$(put_position "$token_header" "{\"cfi\":\"$(head -c 5000 /dev/zero | tr '\0' 'a')\",\"fraction\":0.5}")"
[ "$code" = "400" ] || fail "PUT with a 5000-character CFI returned $code, expected 400"
code="$(position_status)"
[ "$code" = "401" ] || fail "GET /Oriel/Positions/$item_id without a token returned $code, expected 401"
code="$(put_position "$CLIENT_HEADER" "{\"cfi\":\"$POSITION_CFI\",\"fraction\":0.5}")"
[ "$code" = "401" ] || fail "PUT /Oriel/Positions/$item_id without a token returned $code, expected 401"
code="$(position_status -H "Authorization: $token_header")"
[ "$(json_str cfi < "$work/body")" = "$POSITION_CFI" ] || fail "a rejected PUT changed the stored position: $(cat "$work/body")"
pass "malformed positions are rejected with 400 and change nothing; without a token both calls are 401"

read -r reader_id reader_header <<< "$(make_user oriel-reader "reader-$RANDOM$RANDOM")"
code="$(position_status -H "Authorization: $reader_header")"
[ "$code" = "404" ] || fail "a second user reading the first user's book position got $code, expected 404 (they have none stored)"
code="$(put_position "$reader_header" "{\"cfi\":\"epubcfi(/6/4!/4/2/1:0)\",\"fraction\":0.1}")"
[ "$code" = "200" ] || fail "the second user saving their own position returned $code"
code="$(position_status -H "Authorization: $token_header")"
[ "$(json_str cfi < "$work/body")" = "$POSITION_CFI" ] || fail "the second user's save changed the first user's position: $(cat "$work/body")"
pass "a user with nothing stored gets 404, and each user reads and writes only their own position"

read -r restricted_id restricted_header <<< "$(make_user oriel-restricted "restricted-$RANDOM$RANDOM")"
code="$(get_status -H "Authorization: $token_header" "$base/Users/$restricted_id")"
[ "$code" = "200" ] || fail "GET /Users/$restricted_id returned $code"
python3 - "$work/body" > "$work/policy.json" 2>/dev/null <<'PY' || node -e 'const p=require(process.argv[1]).Policy;p.EnableAllFolders=false;p.EnabledFolders=[];process.stdout.write(JSON.stringify(p))' "$(hostpath "$work/body")" > "$work/policy.json"
import json, sys
policy = json.load(open(sys.argv[1]))["Policy"]
policy["EnableAllFolders"] = False
policy["EnabledFolders"] = []
print(json.dumps(policy))
PY
code="$(get_status -X POST -H 'Content-Type: application/json' -H "Authorization: $token_header" \
    --data-binary "@$work/policy.json" "$base/Users/$restricted_id/Policy")"
[ "$code" = "204" ] || fail "restricting user oriel-restricted returned $code"
code="$(position_status -H "Authorization: $restricted_header")"
[ "$code" = "404" ] || fail "a user without access to the books library read a position for its book: $code, expected 404"
code="$(put_position "$restricted_header" "{\"cfi\":\"$POSITION_CFI\",\"fraction\":0.5}")"
[ "$code" = "404" ] || fail "a user without access to the books library saved a position for its book: $code, expected 404"
code="$(put_position "$token_header" "{\"cfi\":\"$POSITION_CFI\",\"fraction\":0.5}" 00000000000040008000000000000000)"
[ "$code" = "404" ] || fail "saving a position for an id that is not an item returned $code, expected 404"
pass "positions for a book the user cannot see, or for an id that is not an item, are 404"

# --- plugin data in the built-in backup ------------------------------------

# A plugin's data folder is its assembly name under the plugins folder. A
# marker file there goes through a backup with every option on, is deleted,
# and the backup is restored. The server name, which the backup keeps in
# system.xml, is the control that shows the restore ran. Jellyfin 12.0 and
# 12.2 leave the plugins folder out of the backup, so the marker is neither in
# the archive nor restored; ORIEL_EXPECT_BACKUP_KEEPS_PLUGIN_DATA=true expects
# the opposite.
expect_kept="${ORIEL_EXPECT_BACKUP_KEEPS_PLUGIN_DATA:-false}"
data_dir="/config/plugins/Jellyfin.Plugin.Oriel"
marker="oriel-backup-marker.txt"
marker_text="oriel backup marker $RANDOM$RANDOM"

set_server_name() {
    code="$(get_status -H "Authorization: $token_header" "$base/System/Configuration")"
    [ "$code" = "200" ] || fail "GET /System/Configuration returned $code"
    sed -E "s/\"ServerName\":\"[^\"]*\"/\"ServerName\":\"$1\"/" "$work/body" > "$work/system.json"
    grep -q "\"ServerName\":\"$1\"" "$work/system.json" || fail "could not set ServerName in /System/Configuration"
    code="$(get_status -X POST -H 'Content-Type: application/json' -H "Authorization: $token_header" \
        --data-binary "@$work/system.json" "$base/System/Configuration")"
    [ "$code" = "204" ] || fail "POST /System/Configuration returned $code"
}
server_name() { curl -sf -H "Authorization: $token_header" "$base/System/Configuration" | json_str ServerName; }
read_marker() { MSYS_NO_PATHCONV=1 docker exec "$container" cat "$data_dir/$marker" 2>/dev/null || true; }

MSYS_NO_PATHCONV=1 docker exec "$container" sh -c "mkdir -p '$data_dir' && printf '%s' '$marker_text' > '$data_dir/$marker'" \
    || fail "write the marker to $data_dir"
set_server_name oriel-before-backup

code="$(get_status -X POST -H 'Content-Type: application/json' -H "Authorization: $token_header" \
    -d '{"Metadata":true,"Trickplay":true,"Subtitles":true,"Database":true}' "$base/Backup/Create")"
[ "$code" = "200" ] || fail "POST /Backup/Create returned $code: $(cat "$work/body")"
archive="$(json_str Path < "$work/body")"
[ -n "$archive" ] || fail "no archive path in the /Backup/Create response: $(cat "$work/body")"
MSYS_NO_PATHCONV=1 docker cp "$container:$archive" "$(hostpath "$work/backup.zip")" >/dev/null || fail "copy $archive out of the server"
unzip -Z1 "$work/backup.zip" > "$work/backup.list" || fail "list $archive"
grep -q '^Config/system.xml$' "$work/backup.list" || fail "the backup holds no Config/system.xml, so the control cannot work"
echo "INFO: $IMAGE backup holds $(wc -l < "$work/backup.list" | tr -d ' ') files, under:" \
    $(cut -d/ -f1-2 "$work/backup.list" | sort -u | tr '\n' ' ')
in_archive=false
grep -q "$marker\$" "$work/backup.list" && in_archive=true
config_in_archive=false
grep -q 'Jellyfin.Plugin.Oriel.xml$' "$work/backup.list" && config_in_archive=true
[ "$in_archive" = "$expect_kept" ] \
    || fail "the plugin data marker in the backup archive: $in_archive, expected $expect_kept"
pass "a backup with every option on: plugin data marker in the archive=$in_archive, plugin settings (Jellyfin.Plugin.Oriel.xml) in the archive=$config_in_archive"

MSYS_NO_PATHCONV=1 docker exec "$container" rm -f "$data_dir/$marker" || fail "delete the marker"
set_server_name oriel-after-backup
code="$(get_status -X POST -H 'Content-Type: application/json' -H "Authorization: $token_header" \
    -d "{\"ArchiveFileName\":\"$(basename "$archive")\"}" "$base/Backup/Restore")"
[ "$code" = "204" ] || fail "POST /Backup/Restore returned $code: $(cat "$work/body")"
# The server restarts to restore; wait until it is down, then up again.
for _ in $(seq 1 60); do
    curl -sf "$base/System/Info/Public" >/dev/null 2>&1 || break
    sleep 1
done
wait_ready "$base"
[ "$(server_name)" = "oriel-before-backup" ] \
    || fail "after the restore the server name is '$(server_name)', expected oriel-before-backup; the restore did not run"
restored=false
[ "$(read_marker)" = "$marker_text" ] && restored=true
[ "$restored" = "$expect_kept" ] \
    || fail "the plugin data marker after the restore: $restored, expected $expect_kept"
pass "after the restore the server name is back (the restore ran); plugin data marker restored=$restored"

# --- jellyfin-web integration ----------------------------------------------

# Read the whole log first: grep -q stops early, and under pipefail the cut-off
# docker logs would fail the check.
docker logs "$container" > "$work/server.log" 2>&1
grep -q 'File Transformation 3.x is not installed' "$work/server.log" \
    || fail "without File Transformation the plugin did not log that the integration is unavailable"
pass "without File Transformation the plugin logs that the integration is unavailable and still serves the reader"

# The pinned File Transformation release is built for one server version.
if [ "$JELLYFIN_VERSION" != "$FT_SERVER_VERSION" ]; then
    echo "SKIP: the jellyfin-web integration checks need Jellyfin $FT_SERVER_VERSION, the version File Transformation $FT_VERSION is built for; $IMAGE runs $JELLYFIN_VERSION"
    echo "smoke-plugin: all checks passed"
    exit 0
fi

# Presses Play or Resume ($3) and expects the oriel or builtin reader ($2),
# and, for Oriel, the line $4 on screen when given.
check_takeover_in_browser() {
    ORIEL_BASE="$1" ORIEL_EXPECT="$2" ORIEL_BUTTON="$3" ORIEL_SERVER_ID="$server_id" ORIEL_USER_ID="$user_id" \
    ORIEL_TOKEN="$token" ORIEL_ITEM_ID="${5:-$item_id}" ORIEL_EXPECT_TEXT="${4:-}" \
        node "$reader/e2e/takeover.e2e.mjs" || fail "$3 in jellyfin-web at $1 did not open the $2 reader for ${5:-the test EPUB}"
}

# Opens the reader signed out, signs in on the jellyfin-web login page it is
# sent to, and expects the book's detail page or the book in Oriel ($2).
check_login_return() {
    ORIEL_BASE="$1" ORIEL_EXPECT="$2" ORIEL_START="${3:-book}" ORIEL_ITEM_ID="$item_id" ORIEL_USER="$ADMIN_USER" ORIEL_PASSWORD="$ADMIN_PW" \
    ORIEL_EXPECT_TEXT="$BOOK_TEXT" \
        node "$reader/e2e/login-return.e2e.mjs" || fail "signing in from the signed-out ${3:-book} page at $1 did not reach the $2 page"
}

# Saves or clears the test EPUB's position, so its detail page offers Resume or Play.
set_progress() { write_user_data "{\"PlaybackPositionTicks\":$2}" "$1" "${3:-}"; }

# The integration off: jellyfin-web is served exactly as shipped.
check_web_stock() {
    local prefix="$1"
    for file in index.html config.json; do
        curl -sf -o "$work/served" "$prefix/web/$file" || fail "GET $prefix/web/$file"
        MSYS_NO_PATHCONV=1 docker exec "$container" cat "/jellyfin/jellyfin-web/$file" > "$work/stock" || fail "read the stock $file"
        cmp -s "$work/served" "$work/stock" || fail "$prefix/web/$file differs from the stock file with the integration off"
    done
    pass "with the integration off, $prefix/web/index.html and config.json are byte-for-byte the stock files"
}

# The integration on: one classic launcher script in index.html, the player in config.json.
check_web_patched() {
    local prefix="$1"
    curl -sf -o "$work/served" "$prefix/web/index.html" || fail "GET $prefix/web/index.html"
    count="$(grep -o '<script src="../Oriel/integration/launcher.js"></script>' "$work/served" | wc -l | tr -d ' ')"
    [ "$count" = "1" ] || fail "$prefix/web/index.html carries $count launcher script tags, expected 1"
    curl -sf -o "$work/served" "$prefix/web/config.json" || fail "GET $prefix/web/config.json"
    grep -q '"OrielBookPlayer"' "$work/served" || fail "$prefix/web/config.json does not list OrielBookPlayer"
    grep -q '"bookPlayer/plugin"' "$work/served" || fail "$prefix/web/config.json lost the stock book player"
    code="$(get_status "$prefix/Oriel/integration/launcher.js")"
    [ "$code" = "200" ] || fail "GET $prefix/Oriel/integration/launcher.js returned $code"
    pass "with the integration on, $prefix/web/index.html carries one launcher script and config.json lists OrielBookPlayer"
}

set_integration() {
    local prefix="$1" value="$2"
    code="$(get_status -H "Authorization: $token_header" "$prefix/Plugins/$PLUGIN_ID/Configuration")"
    [ "$code" = "200" ] || fail "GET the $PLUGIN_NAME configuration returned $code"
    sed -E "s/\"EnableWebIntegration\": *(true|false)/\"EnableWebIntegration\":$value/" "$work/body" > "$work/oriel-config.json"
    grep -q "\"EnableWebIntegration\":$value" "$work/oriel-config.json" || fail "could not set EnableWebIntegration in $(cat "$work/body")"
    code="$(get_status -X POST -H 'Content-Type: application/json' -H "Authorization: $token_header" \
        --data-binary "@$work/oriel-config.json" "$prefix/Plugins/$PLUGIN_ID/Configuration")"
    [ "$code" = "204" ] || fail "POST the $PLUGIN_NAME configuration returned $code"
}

MSYS_NO_PATHCONV=1 docker exec "$container" cp -r /oriel-ft "/config/plugins/FileTransformation_$FT_VERSION" || fail "install File Transformation"
docker restart "$container" >/dev/null || fail "docker restart"
port="$(docker port "$container" 8096/tcp | head -1 | sed 's/.*://')"
base="http://127.0.0.1:$port"
wait_ready "$base"
check_plugin_active "$base" "File Transformation"

code="$(position_status -H "Authorization: $token_header")"
[ "$code" = "200" ] && [ "$(json_str cfi < "$work/body")" = "$POSITION_CFI" ] \
    || fail "after a backup restore and a server restart the stored position is gone ($code: $(cat "$work/body"))"
pass "the stored position survives a server restart"

# The reader stores the exact position, reopens on the same page, and lets a
# Jellyfin position saved later win.
ORIEL_BASE="$base" ORIEL_SERVER_ID="$server_id" ORIEL_USER_ID="$user_id" ORIEL_TOKEN="$token" \
ORIEL_ITEM_ID="$item_id" ORIEL_LATER_TEXT="Oriel smoke chapter two starts here." \
    node "$reader/e2e/exact.e2e.mjs" || fail "the reader did not keep or choose the exact position at $base"

# Exporting and importing reading data: own data only, newer wins, matching by
# title for an unknown id, unmatched books reported, bad files rejected.
ORIEL_BASE="$base" ORIEL_TOKEN="$token" ORIEL_ITEM_ID="$item_id" \
ORIEL_OTHER_TOKEN="$(sed -E 's/.*Token="([^"]*)".*/\1/' <<< "$reader_header")" ORIEL_OTHER_CFI="epubcfi(/6/4!/4/2/1:0)" \
    node "$reader/e2e/reading-data.e2e.mjs" || fail "exporting or importing reading data at $base"

# The Your reading data page: download, import and its summary, the bad-file
# alert, Back to the book, and the sign-in redirect, at phone and desktop widths.
ORIEL_BASE="$base" ORIEL_SERVER_ID="$server_id" ORIEL_USER_ID="$user_id" ORIEL_TOKEN="$token" ORIEL_ITEM_ID="$item_id" \
    node "$reader/e2e/data-page.e2e.mjs" || fail "the reading data page at $base"

# A newest saved place that is not in the book: the reader opens at Jellyfin's
# place, else the saved fraction, else the start, and says so.
ORIEL_BASE="$base" ORIEL_SERVER_ID="$server_id" ORIEL_USER_ID="$user_id" ORIEL_TOKEN="$token" ORIEL_ITEM_ID="$item_id" \
ORIEL_FIRST_TEXT="$BOOK_TEXT" ORIEL_JELLYFIN_TEXT="$PROGRESS_TEXT" \
    node "$reader/e2e/missing-place.e2e.mjs" || fail "a saved place that is not in the book at $base"

# Books in other formats: the comic shows its first page, the Kindle books their
# first chapter and the PDF its first page's text, and a page turned in each is
# saved, mirrored and reopened.
ORIEL_BASE="$base" ORIEL_SERVER_ID="$server_id" ORIEL_USER_ID="$user_id" ORIEL_TOKEN="$token" ORIEL_CBZ_ID="$cbz_id" \
ORIEL_MOBI_ID="$mobi_id" ORIEL_MOBI_TEXT="$MOBI_TEXT" ORIEL_AZW3_ID="$azw3_id" ORIEL_AZW3_TEXT="$AZW3_TEXT" \
ORIEL_PDF_ID="$pdf_id" ORIEL_PDF_TEXT="$PDF_TEXT" \
    node "$reader/e2e/formats.e2e.mjs" || fail "opening books in other formats at $base"

check_web_stock "$base"
set_progress "$base" "$PROGRESS_TICKS"
check_takeover_in_browser "$base" builtin Resume
set_progress "$base" 0
check_takeover_in_browser "$base" builtin Play
check_login_return "$base" details
check_login_return "$base" home data
set_integration "$base" true
check_web_patched "$base"
check_login_return "$base" oriel
check_login_return "$base" data data
check_takeover_in_browser "$base" oriel Play
# These books were read above; with no progress in Jellyfin their button reads Play.
for other_id in "$cbz_id" "$mobi_id" "$azw3_id" "$pdf_id"; do
    set_progress "$base" 0 "$other_id"
    check_takeover_in_browser "$base" oriel Play "" "$other_id"
done
set_progress "$base" "$PROGRESS_TICKS"
check_takeover_in_browser "$base" oriel Resume "$PROGRESS_TEXT"
# Last here, because their slider and Contents move the test EPUB.
check_controls_in_browser "$base"
check_contents_in_browser "$base"

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
# The reader opens at the saved position, and this check expects the first chapter.
set_progress "http://127.0.0.1:$port/jf" 0
check_reader_in_browser "http://127.0.0.1:$port/jf"
check_web_patched "http://127.0.0.1:$port/jf"
check_login_return "http://127.0.0.1:$port/jf" oriel
check_login_return "http://127.0.0.1:$port/jf" data data
set_progress "http://127.0.0.1:$port/jf" "$PROGRESS_TICKS"
check_takeover_in_browser "http://127.0.0.1:$port/jf" oriel Resume "$PROGRESS_TEXT"
set_progress "http://127.0.0.1:$port/jf" 0
check_takeover_in_browser "http://127.0.0.1:$port/jf" oriel Play
check_controls_in_browser "http://127.0.0.1:$port/jf"
check_contents_in_browser "http://127.0.0.1:$port/jf"

# --- install from a plugin repository --------------------------------------

# Packages a newer version, serves its manifest and zip from the server's own
# web folder, and installs Oriel from that repository the way an admin would in
# the dashboard. The server fetches them from itself, inside its container.
prefix="http://127.0.0.1:$port/jf"
repo_version="99.0.0"
repo_inside="http://localhost:8096/jf/web/oriel-repo"
py="$(command -v python3 || command -v python || true)"
[ -n "$py" ] || fail "Python 3 is needed to package the plugin"
"$py" "$repo/scripts/package-plugin.py" --version "$repo_version" --out "$work/repo/v$repo_version" \
    --url-base "$repo_inside" --changelog "Smoke test release." --jellyfin-version "$JELLYFIN_VERSION" >/dev/null \
    || fail "package Oriel $repo_version"
mv "$work/repo/v$repo_version/manifest.json" "$work/repo/manifest.json"
MSYS_NO_PATHCONV=1 docker cp "$(hostpath "$work/repo")" "$container:/jellyfin/jellyfin-web/oriel-repo" >/dev/null \
    || fail "copy the test repository into the server"
code="$(get_status "$prefix/web/oriel-repo/manifest.json")"
[ "$code" = "200" ] || fail "the server does not serve the test repository manifest ($code)"

code="$(get_status -X POST -H 'Content-Type: application/json' -H "Authorization: $token_header" \
    -d "[{\"Name\":\"Oriel smoke\",\"Url\":\"$repo_inside/manifest.json\",\"Enabled\":true}]" "$prefix/Repositories")"
[ "$code" = "204" ] || fail "POST /Repositories returned $code: $(cat "$work/body")"
code="$(get_status -H "Authorization: $token_header" "$prefix/Packages")"
[ "$code" = "200" ] || fail "GET /Packages returned $code"
grep -q "\"name\":\"$PLUGIN_NAME\"" "$work/body" && grep -q "\"version\":\"$repo_version.0\"" "$work/body" \
    || fail "the catalog does not list $PLUGIN_NAME $repo_version.0 from the repository: $(head -c 400 "$work/body")"
pass "adding the repository lists $PLUGIN_NAME $repo_version.0 in the plugin catalog"

repo_url_query="$("$py" -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$repo_inside/manifest.json")"
code="$(get_status -X POST -H "Authorization: $token_header" \
    "$prefix/Packages/Installed/$PLUGIN_NAME?assemblyGuid=$PLUGIN_ID&version=$repo_version.0&repositoryUrl=$repo_url_query")"
[ "$code" = "204" ] || fail "installing $PLUGIN_NAME $repo_version.0 from the repository returned $code: $(cat "$work/body")"
docker restart "$container" >/dev/null || fail "docker restart"
port="$(docker port "$container" 8096/tcp | head -1 | sed 's/.*://')"
prefix="http://127.0.0.1:$port/jf"
wait_ready "$prefix"
code="$(get_status -H "Authorization: $token_header" "$prefix/Plugins")"
[ "$code" = "200" ] || fail "GET /Plugins returned $code"
entry="$(sed 's/},{/}\n{/g' "$work/body" | grep "\"Name\":\"$PLUGIN_NAME\"" | grep "\"Version\":\"$repo_version.0\"" || true)"
[ -n "$entry" ] || fail "after installing from the repository, /Plugins does not list $PLUGIN_NAME $repo_version.0: $(cat "$work/body")"
[ "$(echo "$entry" | json_str Status)" = "Active" ] || fail "$PLUGIN_NAME $repo_version.0 is not Active: $entry"
code="$(get_status "$prefix/Oriel/")"
[ "$code" = "200" ] || fail "after installing from the repository GET /Oriel/ returned $code"
pass "$PLUGIN_NAME $repo_version.0 installs from the repository, is Active after a restart and serves the reader"

echo "smoke-plugin: all checks passed"
