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
#
# The server listens on port 8096 on every interface (ORIEL_DEV_PORT to change
# it), so phones on the same network can reach it. Server settings, users and
# the library index live in Docker volumes and survive restarts. ORIEL_BOOKS is
# read only when the server is first created.
#
# Needs: bash, docker, Node and npm, the .NET 10 SDK.
set -euo pipefail

IMAGE="${JELLYFIN_IMAGE:-jellyfin/jellyfin:12.2.20261005-225228}"
PORT="${ORIEL_DEV_PORT:-8096}"
CONTAINER="oriel-dev"
PLUGIN_DIR_NAME="Oriel_0.1.0.0"

repo="$(cd "$(dirname "$0")/.." && pwd)"
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
    reset)
        docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
        docker volume rm oriel-dev-config oriel-dev-cache >/dev/null 2>&1 || true
        echo "dev-server: removed the server and its data"
        ;;
    *)
        sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
        exit 2
        ;;
esac
