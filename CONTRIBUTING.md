# Contributing to Oriel

Thanks for your interest. Oriel is in early development, so please open an issue to discuss a change before starting on a pull request.

## Reporting a problem

Open an issue with the bug report template. Include the Jellyfin server version, the Oriel version or commit, the browser or app and device, and the steps that show the problem. Security problems go through private reporting instead; see [SECURITY.md](SECURITY.md).

## Making a change

1. Fork the repository and branch from `main`.
2. Build and test as the [README](README.md#building-and-testing) describes. A change to the plugin or the reader should pass `dotnet test`, `npm --prefix src/reader test` and `bash scripts/smoke-plugin.sh`.
3. Write commit messages and the pull request title as [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `test:`, `ci:` or `chore:`, then what changed.
4. Open a pull request against `main`. CI runs the build, the tests and the smoke test; they must pass before the change can merge. Pull requests are squash-merged.

## Third-party code

Only code under licenses compatible with GPL-3.0 can be added. A new vendored library or font needs an entry in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) with its version, copyright line and full license text; `scripts/check-community-files.sh` fails without it.

## License

By contributing you agree that your contribution is licensed under the GNU General Public License v3.0 or later, the license of this project.

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
