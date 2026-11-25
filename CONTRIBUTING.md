# Contributing to Oriel

Thanks for your interest. For anything larger than a small fix, please open an issue or a discussion before starting on a pull request, so the change can be agreed first.

## Questions and ideas

Ask questions, get setup help and share ideas in [Discussions](https://github.com/pathimmersive/jellyfin-plugin-oriel/discussions). Issues are for bugs and feature requests.

## Reporting a problem

Open an issue with the bug report form. It asks for the Jellyfin server version, the Oriel version or commit, the browser or app and device, the book's format and the steps that show the problem. To suggest a feature, use the feature request form.

Security problems go through private reporting instead, never a public issue; see [SECURITY.md](SECURITY.md).

## Making a change

1. Fork the repository and branch from `main`.
2. Build and test as the [README](README.md#building-and-testing) describes. A change to the plugin or the reader should pass `dotnet test`, `npm --prefix src/reader test`, `npm --prefix src/reader run lint` and `bash scripts/smoke-plugin.sh`. A .NET analyzer warning fails the build. A finding of the analyzers or ESLint that is a false positive is silenced on its own line with its reason; [.editorconfig](.editorconfig) and [eslint.config.mjs](src/reader/lint/eslint.config.mjs) show how.
3. Write commit messages and the pull request title as [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `test:`, `ci:` or `chore:`, then what changed.
4. If users will notice the change, add a line for it under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md), in the section that fits (`Added`, `Changed`, `Fixed`, `Security`). A release's section becomes its release notes and the changelog in Jellyfin's plugin catalog.
5. Open a pull request against `main`. CI runs the build, the tests and the smoke test; they must pass before the change can merge. Pull requests are squash-merged.

## Making a release

Releases are made by repository admins, from `main`.

1. Move the lines under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md) into a new `## [X.Y.Z] - YYYY-MM-DD` section. That section becomes the release notes and the changelog in Jellyfin's plugin catalog, and a tag whose version has no section fails before anything is built.
2. Before the first release, remove the "first release is in preparation" line from the README's Installing section. `scripts/check-community-files.sh --release` fails while it remains, and the release workflow runs it before building.
3. Merge those changes through a pull request, then push a tag `vX.Y.Z` on `main`.

Releases are switched off until the repository variable `RELEASES_ENABLED` is `true` (under **Settings**, Secrets and variables, Actions, Variables). While it is off, a pushed tag fails the release workflow's first job with "Releases are switched off", and nothing is built, released or published.

When releases are on, the tag runs the release workflow:
- it builds the plugin as version `X.Y.Z.0`;
- it attaches `oriel_X.Y.Z.0.zip` and its SHA-256 (`oriel_X.Y.Z.0.zip.sha256`) to a GitHub release;
- it publishes `manifest.json` to GitHub Pages with every earlier version still listed.

The zip's build provenance is attested: `gh attestation verify oriel_X.Y.Z.0.zip --repo pathimmersive/jellyfin-plugin-oriel` shows it was built by this repository's release workflow. The build runs no dependency install scripts, the job that publishes builds nothing, and only repository admins can push `v*` tags. `scripts/package-plugin.py` does the packaging and can be run locally the same way.

## The logo

Oriel's logo is drawn in the SVG files in `branding/`. Every PNG made from them (the plugin's catalog image, the reader's icons and the social preview) comes from `node scripts/make-branding.mjs`; change an SVG, run it, and commit the images it writes. The smoke test fails when an image no longer matches its source.

## Third-party code

Only code under licenses compatible with GPL-3.0 can be added. A new vendored library or font needs an entry in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) with its version, copyright line and full license text; `scripts/check-community-files.sh` fails without it.

## License

By contributing you agree that your contribution is licensed under the GNU General Public License v3.0 or later, the license of this project.

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
