# Oriel: A Jellyfin E-Reader Plugin
Oriel is a greenfield, open source Jellyfin server plugin that provides a full-featured e-book reader for Jellyfin 12.0 and later. Jellyfin 12.0 added in-app book reading, but the built-in reader (epub.js 0.3.93 in jellyfin-web) only offers a table of contents, three themes, five font sizes, and fullscreen. Theme and font size are not persisted, layout is paged only, and there are no bookmarks, highlights, or search. My benchmark for a good reading experience is KyBook 3 on iOS. Contributing these improvements upstream was evaluated and ruled out: no outside book-reader PRs merged into jellyfin-web in 2026, and annotation storage is blocked on a stalled core API. A plugin lets me own the schedule.

The plugin hosts its own reader web app on the Jellyfin server, on the same origin as jellyfin-web, so it can reuse the signed-in user's session and work from any browser, a phone home-screen shortcut, and (if verified) the official Jellyfin mobile apps. Integration into jellyfin-web itself (a "Read" button or replacing the built-in book player) is an optional extra, never a requirement, because Jellyfin has no supported UI extension point.

## Major Features
1. A plugin-hosted reader page (e.g. `/Oriel/?id=<itemId>`) that opens EPUB books from a Jellyfin library using the signed-in user's existing session. No second login.
2. Rich typography and layout controls, persisted per user and synced across devices:
    - Font family (including a small set of bundled fonts), font size, line height, paragraph spacing and indent, margins
    - Justification and hyphenation toggles
    - Option to override publisher styles
    - Light, dark, sepia, and custom color themes
    - Paged or continuous scroll layout, single page or two-page spread
3. Navigation:
    - Table of contents, progress bar with percentage and location, chapter time remaining
    - Configurable tap zones and swipe gestures (built for iPhone and iPad first)
    - Full-text search inside the book
4. Reading position:
    - Exact position (EPUB CFI) stored per user by the plugin, so resuming lands on the same spot on any device
    - Percentage mirrored into Jellyfin's own user data so Continue Reading and the built-in reader stay roughly in sync
5. Annotations:
    - Bookmarks, highlights in multiple colors, and notes on highlights
    - Annotation list per book with jump-to
    - Export of a book's annotations to Markdown
6. Read-aloud (text-to-speech via the browser) and dictionary lookup on a selected word.
7. PDF and comic (CBZ) support as a later phase.
8. Optional jellyfin-web integration: a "Read" button on book detail pages, or taking over the built-in book player. Off by default and isolated so a jellyfin-web change can only break the integration, never the reader.

## Technical Considerations
1. Server side is a C# Jellyfin plugin on .NET 10 targeting the Jellyfin 12.x plugin ABI (`Jellyfin.Controller 12.*`). Plugins must be rebuilt for every Jellyfin major release; that is expected maintenance.
2. The reader UI is TypeScript built on foliate-js (MIT). foliate-js has no releases and states its API may change, so the version is pinned to a specific commit and upgraded on purpose.
3. Plugin storage is a private SQLite file in the plugin data folder (the Playback Reporting pattern). Plugins cannot add tables to `jellyfin.db`.
4. Authentication reuses the jellyfin-web token from `localStorage["jellyfin_credentials"]` and sends it as an `Authorization: MediaBrowser Token="..."` header. Jellyfin 12.0 disables legacy auth headers by default. The reader HTML/assets are served anonymously; every data endpoint requires an authenticated user.
5. Book files are fetched through `GET /Items/{id}/Download`, which respects the user's library access and download permission. Any plugin-owned file endpoint must enforce the same access checks.
6. Distribution is a self-hosted Jellyfin plugin repository `manifest.json` (GitLab Pages) with release artifacts and checksums produced by CI.
7. The primary target is iOS Safari and the iOS home-screen web app. Desktop browsers are secondary. Native clients (Swiftfin, Android TV, Roku) cannot run the reader and are out of scope.

## Open Source Considerations
1. The repository is public and licensed GPL-3.0-or-later, consistent with the Jellyfin plugin template and the GPL licensing of the Jellyfin libraries the plugin links against.
2. Third-party code (foliate-js, fonts, any other dependency) keeps its own license and is listed in `THIRD_PARTY_NOTICES.md`. Only GPL-3.0-compatible licenses are accepted.
3. The plugin is an unofficial, third-party project. It does not use the Jellyfin logo or imply endorsement by the Jellyfin project.
4. Standard community files: README, LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, and issue/MR templates.
5. No private Path Immersive infrastructure details (hostnames, registry URLs, credentials, server configs) are committed to this repository.

## Known Unknowns (first spike)
The first milestone is a one-week spike that answers these before any feature work:
1. Does the reader page work inside the official Jellyfin iOS app, or only in Safari and as a home-screen web app?
2. foliate-js performance and text selection on iOS Safari with a large EPUB.
3. Can an injected script register a book player in jellyfin-web 12.x early enough to take over from the built-in one?
4. Does Continue Reading pick up books whose progress is written through `/UserItems/{id}/UserData` without a runtime set?
5. Is plugin data included in Jellyfin 12.0's built-in backup?

## References
- `docs/research/jellyfin-ebook-reader-contribution-effort.md` — the built-in reader's state and why upstream contribution was ruled out
- `docs/research/jellyfin-ebook-reader-plugin-feasibility.md` — plugin capabilities, engine choice, effort estimates (MVP roughly 10–14 person-weeks, full feature set 18–26)
