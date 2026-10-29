# Oriel

Oriel is an e-book reader for Jellyfin, hosted by the Jellyfin server as a plugin. It opens EPUB books from your Jellyfin libraries in the browser, on a phone's home screen, and inside the official Jellyfin apps, using the account you are already signed in with.

**Oriel is an unofficial, third-party plugin.** It is not made, endorsed or supported by the Jellyfin project, and it does not use the Jellyfin logo.

## Status

Early development; there is no release yet. What works today:

- A reader page at `/Oriel/?id=<itemId>` that renders EPUB books from your library with [foliate-js](https://github.com/johnfactotum/foliate-js).
- With the optional jellyfin-web integration, which needs the [File Transformation](https://github.com/IAmParadox27/jellyfin-plugin-file-transformation) plugin, Play and Resume on an EPUB open Oriel instead of the built-in reader.
- Oriel keeps your exact place in each book, per user, and opens where you stopped, also after reading in another app.
- Your reading positions can be exported to a file and imported again, on the same server or another one, through `/Oriel/Export` and `/Oriel/Import`.

Oriel has been tried in Safari and the Jellyfin app on iOS, and in the Jellyfin app on Android. Reader settings and annotations are planned but not built yet.

## Requirements

- Jellyfin 12.0 or later. The build targets 12.2 and is tested against the `jellyfin/jellyfin:12.2.20261005-225228` image.

## Installing

Once the first release is published, Oriel installs from its own plugin repository:

1. In Jellyfin, open **Dashboard → Plugins → Repositories** (on older versions, **Catalog → Settings**) and add a repository with any name and this URL:
   `https://pathimmersive.github.io/jellyfin-plugin-oriel/manifest.json`
2. Find **Oriel** in the plugin catalog and install it.
3. Restart the Jellyfin server.

Updates appear in the same catalog. Each release's zip is also attached to its [GitHub release](https://github.com/pathimmersive/jellyfin-plugin-oriel/releases) for manual installs: unzip it into a folder named `Oriel_<version>` in the server's `plugins` folder and restart.

## Building and testing

You need the .NET 10 SDK, Node.js 24 with npm, bash and, for the smoke test, Docker.

```bash
dotnet test                            # builds the reader and the plugin, runs the plugin tests
npm --prefix src/reader test           # reader unit tests
bash scripts/smoke-plugin.sh           # loads the plugin into a throwaway Jellyfin container and checks it end to end
bash scripts/check-community-files.sh  # community files and third-party notices
bash scripts/test-package.sh           # release packaging: the zip and the repository manifest (needs Python 3)
```

`scripts/dev-server.sh` runs a local Jellyfin server with the current build installed; run it with no arguments for its usage.

## Releasing

Pushing a tag `vX.Y.Z` on `main` runs the release workflow: it builds the plugin as version `X.Y.Z.0`, attaches `oriel_X.Y.Z.0.zip` to a GitHub release, and publishes `manifest.json` to GitHub Pages with every earlier version still listed. `scripts/package-plugin.py` does the packaging and can be run locally the same way.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Report security problems privately, as [SECURITY.md](SECURITY.md) describes.

## License

Oriel is licensed under the GNU General Public License v3.0 or later; see [LICENSE](LICENSE). Third-party code keeps its own license; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
