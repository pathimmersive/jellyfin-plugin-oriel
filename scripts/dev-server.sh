#!/usr/bin/env bash
# A local Jellyfin 12.x server for developing the plugin, with the current
# build installed and a books folder mounted read-only.
#
# Usage:
#   ORIEL_BOOKS=/path/to/books scripts/dev-server.sh up   # build, then create or start the server
#   scripts/dev-server.sh reload                           # rebuild the plugin and restart the server
#   scripts/dev-server.sh down                             # stop the server (its data is kept)
#   scripts/dev-server.sh logs                             # follow the server log
#   scripts/dev-server.sh reset                            # remove the server and its data
#   scripts/dev-server.sh integration on|off               # jellyfin-web integration, via File Transformation
#   scripts/dev-server.sh progress "<book title>" <0-1>    # save a reading position for your user
#
# The server listens on port 8096 on every interface (ORIEL_DEV_PORT to change
# it), so phones on the same network can reach it. Server settings, users and
# the library index live in Docker volumes and survive restarts. ORIEL_BOOKS is
# read only when the server is first created. "integration on" installs the
# pinned File Transformation plugin on this server only and restarts it.
# "progress" asks for a Jellyfin user name and password on this server and
# writes the position the way jellyfin-web's book player stores it.
#
# Needs: bash, docker, Node and npm, the .NET 10 SDK.
set -euo pipefail

IMAGE="${JELLYFIN_IMAGE:-jellyfin/jellyfin:12.2.20261005-225228}"
PORT="${ORIEL_DEV_PORT:-8096}"
CONTAINER="oriel-dev"
PLUGIN_DIR_NAME="Oriel_0.1.0.0"

repo="$(cd "$(dirname "$0")/.." && pwd)"
. "$repo/scripts/file-transformation.sh"
plugin_dir="$repo/.dev/plugins/$PLUGIN_DIR_NAME"

fail() { echo "dev-server: $*" >&2; exit 1; }

# Docker Desktop on Windows needs a Windows path for bind mounts.
hostpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else echo "$1"; fi; }

exists() { docker container inspect "$CONTAINER" >/dev/null 2>&1; }

build() {
    echo "dev-server: building the plugin"
    rm -rf "$plugin_dir"
    dotnet publish "$repo/src/Jellyfin.Plugin.Oriel/Jellyfin.Plugin.Oriel.csproj" \
        -c Release -o "$plugin_dir" --nologo -v quiet >/dev/null || fail "dotnet publish failed"
}

# The plugin's settings file, as Jellyfin writes it for PluginConfiguration.
oriel_config() {
    printf '<?xml version="1.0" encoding="utf-8"?>
<PluginConfiguration xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <EnableWebIntegration>%s</EnableWebIntegration>
</PluginConfiguration>
' "$1"
}

set_integration() {
    local value
    case "${1:-}" in
        on) value=true ;;
        off) value=false ;;
        *) fail "usage: $0 integration on|off" ;;
    esac
    exists || fail "no server yet; run '$0 up' first"
    if [ "$value" = true ]; then
        local ft="$repo/.dev/FileTransformation_$FT_VERSION"
        [ -f "$ft/Jellyfin.Plugin.FileTransformation.dll" ] || fetch_file_transformation "$ft" || fail "fetch File Transformation $FT_VERSION"
        MSYS_NO_PATHCONV=1 docker exec "$CONTAINER" mkdir -p /config/plugins/configurations
        MSYS_NO_PATHCONV=1 docker cp "$(hostpath "$ft")/." "$CONTAINER:/config/plugins/FileTransformation_$FT_VERSION" >/dev/null \
            || fail "copy File Transformation into the server"
    fi
    oriel_config "$value" > "$repo/.dev/Jellyfin.Plugin.Oriel.xml"
    MSYS_NO_PATHCONV=1 docker cp "$(hostpath "$repo/.dev/Jellyfin.Plugin.Oriel.xml")" \
        "$CONTAINER:/config/plugins/configurations/Jellyfin.Plugin.Oriel.xml" >/dev/null || fail "write the plugin settings"
    docker restart "$CONTAINER" >/dev/null
    echo "dev-server: jellyfin-web integration $1"
}

# First value of a string field in a JSON body, or nothing; enough for the
# flat fields read here.
json_str() { grep -o "\"$1\":\"[^\"]*\"" | head -1 | sed "s/^\"$1\":\"\(.*\)\"$/\1/" || true; }

save_progress() {
    local title="${1:-}" fraction="${2:-}"
    [ -n "$title" ] && [ -n "$fraction" ] || fail "usage: $0 progress \"<book title>\" <fraction from 0 to 1>"
    # jellyfin-web's book player stores a position as round(fraction x 10^7) ticks.
    local ticks
    ticks="$(awk -v f="$fraction" 'BEGIN { if (f !~ /^(0|1|0?\.[0-9]+)$/ || f > 1) exit 1; printf "%d", f * 10000000 + 0.5 }')" \
        || fail "the fraction must be a number from 0 to 1, such as 0.6"
    exists || fail "no server yet; run '$0 up' first"
    local base="http://localhost:$PORT"
    local client='MediaBrowser Client="oriel-dev", Device="dev-server", DeviceId="oriel-dev-server", Version="1.0.0"'
    local user pw auth token header user_id query item_id
    read -r -p "Jellyfin user on this server: " user
    read -r -s -p "Password: " pw
    echo
    auth="$(curl -sf -X POST -H 'Content-Type: application/json' -H "Authorization: $client" \
        --data-binary @- "$base/Users/AuthenticateByName" <<< "{\"Username\":\"$user\",\"Pw\":\"$pw\"}")" \
        || fail "sign-in failed"
    token="$(echo "$auth" | json_str AccessToken)"
    [ -n "$token" ] || fail "no access token in the sign-in response"
    header="$client, Token=\"$token\""
    user_id="$(curl -sf -H "Authorization: $header" "$base/Users/Me" | json_str Id)"
    [ -n "$user_id" ] || fail "no user id from /Users/Me"
    query="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$title")"
    item_id="$(curl -sf -H "Authorization: $header" \
        "$base/Items?userId=$user_id&Recursive=true&IncludeItemTypes=Book&searchTerm=$query&Limit=1" | json_str Id)"
    [ -n "$item_id" ] || fail "no book matching '$title'"
    curl -sf -o /dev/null -X POST -H 'Content-Type: application/json' -H "Authorization: $header" \
        -d "{\"PlaybackPositionTicks\":$ticks}" "$base/UserItems/$item_id/UserData?userId=$user_id" \
        || fail "saving the position failed"
    curl -sf -o /dev/null -X POST -H "Authorization: $header" "$base/Sessions/Logout" || true
    echo "dev-server: saved $fraction of the way through '$title' ($item_id) for $user"
}

show_urls() {
    echo "dev-server: Jellyfin is at http://localhost:$PORT"
    echo "dev-server: from a phone on this network use http://<this computer's LAN address>:$PORT"
}

case "${1:-}" in
    up)
        build
        if exists; then
            docker start "$CONTAINER" >/dev/null
        else
            [ -n "${ORIEL_BOOKS:-}" ] || fail "set ORIEL_BOOKS to the books folder to mount"
            [ -d "$ORIEL_BOOKS" ] || fail "ORIEL_BOOKS '$ORIEL_BOOKS' is not a folder"
            MSYS_NO_PATHCONV=1 docker run -d --name "$CONTAINER" \
                --restart unless-stopped \
                -p "$PORT:8096" \
                -v oriel-dev-config:/config \
                -v oriel-dev-cache:/cache \
                -v "$(hostpath "$plugin_dir"):/config/plugins/$PLUGIN_DIR_NAME" \
                -v "$(hostpath "$ORIEL_BOOKS"):/media/books:ro" \
                "$IMAGE" >/dev/null || fail "docker run $IMAGE failed"
            echo "dev-server: created; finish the setup wizard in a browser and add a Books library at /media/books"
        fi
        show_urls
        ;;
    reload)
        exists || fail "no server yet; run '$0 up' first"
        build
        docker restart "$CONTAINER" >/dev/null
        show_urls
        ;;
    down)
        exists && docker stop "$CONTAINER" >/dev/null
        echo "dev-server: stopped"
        ;;
    logs)
        docker logs -f "$CONTAINER"
        ;;
    integration)
        set_integration "${2:-}"
        show_urls
        ;;
    progress)
        save_progress "${2:-}" "${3:-}"
        ;;
    reset)
        docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
        docker volume rm oriel-dev-config oriel-dev-cache >/dev/null 2>&1 || true
        echo "dev-server: removed the server and its data"
        ;;
    *)
        sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
        exit 2
        ;;
esac
