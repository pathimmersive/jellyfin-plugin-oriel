# Contributing to Oriel

Thanks for your interest. Oriel is in early development, so please open an issue to discuss a change before starting on a pull request.

## Questions and ideas

Ask questions, get setup help and share ideas in [Discussions](https://github.com/pathimmersive/jellyfin-plugin-oriel/discussions). Issues are for bugs and feature requests.

## Reporting a problem

Open an issue with the bug report form. It asks for the Jellyfin server version, the Oriel version or commit, the browser or app and device, the book's format and the steps that show the problem. To suggest a feature, use the feature request form.

Security problems go through private reporting instead, never a public issue; see [SECURITY.md](SECURITY.md).

## Making a change

1. Fork the repository and branch from `main`.
2. Build and test as the [README](README.md#building-and-testing) describes. A change to the plugin or the reader should pass `dotnet test`, `npm --prefix src/reader test` and `bash scripts/smoke-plugin.sh`.
3. Write commit messages and the pull request title as [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `test:`, `ci:` or `chore:`, then what changed.
4. If users will notice the change, add a line for it under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md), in the section that fits (`Added`, `Changed`, `Fixed`, `Security`). A release's section becomes its release notes and the changelog in Jellyfin's plugin catalog.
5. Open a pull request against `main`. CI runs the build, the tests and the smoke test; they must pass before the change can merge. Pull requests are squash-merged.

## The logo

Oriel's logo is drawn in the SVG files in `branding/`. Every PNG made from them (the plugin's catalog image, the reader's icons and the social preview) comes from `node scripts/make-branding.mjs`; change an SVG, run it, and commit the images it writes. The smoke test fails when an image no longer matches its source.

## Third-party code

Only code under licenses compatible with GPL-3.0 can be added. A new vendored library or font needs an entry in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) with its version, copyright line and full license text; `scripts/check-community-files.sh` fails without it.

## License

By contributing you agree that your contribution is licensed under the GNU General Public License v3.0 or later, the license of this project.

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
