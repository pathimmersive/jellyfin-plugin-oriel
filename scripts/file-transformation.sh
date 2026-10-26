# Sourced by the smoke test and the dev server: the pinned File Transformation
# release, the third-party plugin the jellyfin-web integration goes through.
# The build matches the server version of the pinned Jellyfin image, and the
# MD5 is the one in its publisher's plugin repository manifest.

FT_VERSION="3.0.2.0"
FT_SERVER_VERSION="12.2.0"
FT_URL="https://github.com/IAmParadox27/jellyfin-plugin-file-transformation/releases/download/$FT_VERSION/Release-$FT_SERVER_VERSION.zip"
FT_MD5="76eae3b09a42dba7992820fa8f6a4584"

# Unpacks the release into the folder given, downloading it once into a cache.
fetch_file_transformation() {
    local dest="$1"
    local cache="${XDG_CACHE_HOME:-$HOME/.cache}/oriel/FileTransformation-$FT_VERSION.zip"
    if [ ! -f "$cache" ] || [ "$(md5sum "$cache" | cut -d' ' -f1)" != "$FT_MD5" ]; then
        mkdir -p "$(dirname "$cache")"
        curl -sSfL -o "$cache" "$FT_URL" || { echo "download File Transformation $FT_VERSION failed" >&2; return 1; }
    fi
    [ "$(md5sum "$cache" | cut -d' ' -f1)" = "$FT_MD5" ] || { echo "File Transformation $FT_VERSION does not match its published MD5" >&2; return 1; }
    mkdir -p "$dest"
    unzip -q -o "$cache" -d "$dest"
}
