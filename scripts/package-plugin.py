#!/usr/bin/env python3
"""Builds the plugin at a release version, zips it, and writes the plugin repository manifest.

Usage:
  package-plugin.py --version X.Y.Z --out DIR --url-base URL
                    [--manifest EXISTING] [--changelog TEXT] [--jellyfin-version V]

The zip, oriel_X.Y.Z.0.zip, holds the plugin assembly and meta.json. Its
download address in the manifest is <url-base>/vX.Y.Z/oriel_X.Y.Z.0.zip, the
layout of GitHub release downloads. With --manifest, the new version is added to
that manifest's versions, newest first; without it a new manifest is started.
A malformed version, or one the manifest already lists, fails before anything
is written. Needs Python 3 and the .NET 10 SDK.
"""
import argparse
import datetime
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import zipfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT = os.path.join(REPO, "src", "Jellyfin.Plugin.Oriel", "Jellyfin.Plugin.Oriel.csproj")
PLUGIN_FILES = ["Jellyfin.Plugin.Oriel.dll", "meta.json"]
# A fixed time inside the zip, so the same build gives the same bytes and checksum.
ZIP_TIME = (2000, 1, 1, 0, 0, 0)


def fail(message):
    print(f"package-plugin: {message}", file=sys.stderr)
    sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--version", required=True, help="the release version, X.Y.Z (a leading v is allowed)")
    parser.add_argument("--out", required=True, help="the folder for the zip and manifest.json")
    parser.add_argument("--url-base", required=True, help="where release downloads live")
    parser.add_argument("--manifest", help="an existing manifest.json to add this version to")
    parser.add_argument("--changelog", default="", help="what changed in this version")
    parser.add_argument("--jellyfin-version", help="the Jellyfin.Controller version to build against")
    args = parser.parse_args()

    match = re.fullmatch(r"v?(\d+)\.(\d+)\.(\d+)", args.version)
    if not match:
        fail(f"'{args.version}' is not a version like 1.2.3")
    release = ".".join(match.groups())
    version = release + ".0"

    manifest = []
    if args.manifest:
        try:
            with open(args.manifest, encoding="utf-8") as f:
                manifest = json.load(f)
        except (OSError, ValueError) as error:
            fail(f"cannot read {args.manifest}: {error}")
        if not isinstance(manifest, list):
            fail(f"{args.manifest} is not a plugin repository manifest")

    with tempfile.TemporaryDirectory() as build:
        command = ["dotnet", "publish", PROJECT, "-c", "Release", "-o", build, "--nologo", "-v", "quiet",
                   f"-p:Version={version}"]
        if args.jellyfin_version:
            command.append(f"-p:JellyfinVersion={args.jellyfin_version}")
        if subprocess.run(command, stdout=subprocess.DEVNULL).returncode != 0:
            fail("dotnet publish failed")
        with open(os.path.join(build, "meta.json"), encoding="utf-8") as f:
            meta = json.load(f)
        if meta.get("version") != version:
            fail(f"meta.json says version {meta.get('version')}, expected {version}")

        plugin = next((p for p in manifest if p.get("guid") == meta["guid"]), None)
        if plugin and any(v.get("version") == version for v in plugin.get("versions", [])):
            fail(f"the manifest already lists version {version}")

        os.makedirs(args.out, exist_ok=True)
        zip_name = f"oriel_{version}.zip"
        zip_path = os.path.join(args.out, zip_name)
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
            for name in PLUGIN_FILES:
                with open(os.path.join(build, name), "rb") as f:
                    info = zipfile.ZipInfo(name, ZIP_TIME)
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.external_attr = 0o644 << 16
                    z.writestr(info, f.read())

    with open(zip_path, "rb") as f:
        checksum = hashlib.md5(f.read()).hexdigest()

    if plugin is None:
        plugin = {key: meta[key] for key in ["guid", "name", "description", "overview", "owner", "category"]}
        plugin["versions"] = []
        manifest.append(plugin)
    plugin["versions"].insert(0, {
        "version": version,
        "changelog": args.changelog,
        "targetAbi": meta["targetAbi"],
        "sourceUrl": f"{args.url_base.rstrip('/')}/v{release}/{zip_name}",
        "checksum": checksum,
        "timestamp": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    })
    plugin["versions"].sort(key=lambda v: tuple(int(n) for n in v["version"].split(".")), reverse=True)

    with open(os.path.join(args.out, "manifest.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")
    print(f"package-plugin: {zip_path} ({checksum}) and manifest.json with {len(plugin['versions'])} version(s)")


if __name__ == "__main__":
    main()
