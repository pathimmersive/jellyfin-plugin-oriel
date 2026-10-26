# Oriel

Oriel is an e-book reader for Jellyfin, hosted by the Jellyfin server as a plugin. It opens EPUB books from your Jellyfin libraries in the browser, on a phone's home screen, and inside the official Jellyfin apps, using the account you are already signed in with.

**Oriel is an unofficial, third-party plugin.** It is not made, endorsed or supported by the Jellyfin project, and it does not use the Jellyfin logo.

## Status

Early development; there is no release yet. What works today:

- A reader page at `/Oriel/?id=<itemId>` that renders EPUB books from your library with [foliate-js](https://github.com/johnfactotum/foliate-js).
- With the optional jellyfin-web integration, which needs the [File Transformation](https://github.com/IAmParadox27/jellyfin-plugin-file-transformation) plugin, Play and Resume on an EPUB open Oriel instead of the built-in reader.

[MANIFEST.md](MANIFEST.md) describes what Oriel is meant to become, and `docs/research` records what has been tested so far.

## Requirements

- Jellyfin 12.0 or later. The build targets 12.2 and is tested against the `jellyfin/jellyfin:12.2.20261005-225228` image.

## Building and testing

You need the .NET 10 SDK, Node.js 24 with npm, bash and, for the smoke test, Docker.

```bash
dotnet test                            # builds the reader and the plugin, runs the plugin tests
npm --prefix src/reader test           # reader unit tests
bash scripts/smoke-plugin.sh           # loads the plugin into a throwaway Jellyfin container and checks it end to end
bash scripts/check-community-files.sh  # community files and third-party notices
```

`scripts/dev-server.sh` runs a local Jellyfin server with the current build installed; run it with no arguments for its usage.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Report security problems privately, as [SECURITY.md](SECURITY.md) describes.

## License

Oriel is licensed under the GNU General Public License v3.0 or later; see [LICENSE](LICENSE). Third-party code keeps its own license; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
