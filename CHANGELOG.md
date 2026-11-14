# Changelog

All notable changes to Oriel are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Oriel uses
[semantic versioning](https://semver.org/). Each release's section is the
changelog Jellyfin's plugin catalog shows for that version.

## [Unreleased]

The first release, 0.1.0, will be made from this section.

### Added

- An e-book reader hosted by the Jellyfin server at `/Oriel/`, opening EPUB, PDF, CBZ comic, MOBI and AZW3 books from your libraries in the browser, on a phone's home screen and inside the Jellyfin iOS and Android apps.
- Play and Resume on a book in jellyfin-web open Oriel, with no other plugin to install; an admin can turn this off.
- Your exact place in each book is kept per user on the server, opens where you stopped on every device, and is mirrored to Jellyfin's own progress.
- Reader controls: contents, search in the book, bookmarks, highlights in your own highlighters with notes, and selected-text actions to copy, translate, search, share or look up a word in a dictionary on the server.
- Preferences: themes, including your own custom themes, fonts, including fonts you add when an admin allows it, text size, spacing, margins, page turns or vertical scrolling, and progress in percent or pages; themes, fonts and highlighters follow you to every device.
- A two-page spread with panels on a desktop, landscape on a phone, and page turns with the keyboard, mouse and trackpad.
- Export and import of everything Oriel keeps for you, from the Your reading data page.
- A settings page under Dashboard → Plugins → Oriel for the Play takeover, font uploads and the Translate address.
- A loading screen with the book's cover, title and download progress, and clear messages when a book cannot open or a place cannot be saved.

### Security

- No script inside a book ever runs: the reader is served with a strict Content-Security-Policy and books' scripts are stripped as they load.
- Fonts are read without unbounded memory, uploads are off until an admin turns them on, and each user has limits on fonts, bookmarks, highlights and imports.
- A database Oriel cannot open never stops Jellyfin from starting.
- When Jellyfin deletes a user, Oriel deletes everything it keeps for them.
- Releases are built without dependency install scripts, published by a job that builds nothing, and attested, with a SHA-256 beside each zip.

### Requirements

- Jellyfin 12.2 or later.
