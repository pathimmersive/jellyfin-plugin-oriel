# Player takeover in jellyfin-web 12.x

MANIFEST.md Known Unknowns #3: can a script injected through File Transformation register a book player before jellyfin-web 12.x loads its plugins, so that Play on an EPUB opens Oriel? This note records how jellyfin-web 12.2 loads players, what the plugin does with it, and whether Play opens Oriel on each surface.

## How jellyfin-web 12.2 loads players

Read from the bundle that ships in the `jellyfin/jellyfin:12.2.20261005-225228` image, under `/jellyfin/jellyfin-web`:

- `config.json` lists the plugins to load by name, such as `bookPlayer/plugin`. For a name that is a property of `window`, `pluginManager.loadPlugin` awaits `window[name]()`, expects a class back, and constructs it with jellyfin-web's services (`playbackManager`, `appRouter`, `ServerConnections` and others). Any other name is loaded as a bundled module.
- The built-in book player has `priority = 1`, `canPlayMediaType` true for `book`, and `canPlayItem` true when the item's `Path` ends in `epub`. Players are sorted by ascending priority, so a player at priority 0 is asked first.
- Every script tag in `index.html` is `defer`. A classic script added to the page runs while the page is parsed, before any jellyfin-web bundle, so the player's `window` property exists before `loadPlugins()` runs.

## What the plugin does

With `EnableWebIntegration` on and File Transformation installed, the plugin registers two transformations. Both are made in memory as the files are served, and neither is written to disk:

- **index.html**: one `<script src="../Oriel/integration/launcher.js"></script>` before `</head>`. The relative path resolves under any BaseUrl.
- **config.json**: `OrielBookPlayer` appended to `plugins`.

The launcher defines `window.OrielBookPlayer`: a player at priority 0 that claims only EPUB items and, on play, navigates to `{base}/Oriel/?id=<itemId>`. When the integration is off, or File Transformation is missing, both files are served exactly as shipped and the reader at `/Oriel/` is unaffected.

## Setup

- Server: Jellyfin 12.2.0 (`jellyfin/jellyfin:12.2.20261005-225228`), local development server over plain http on the same Wi-Fi
- File Transformation: 3.0.2.0, 12.2 build (MD5 76EAE3B09A42DBA7992820FA8F6A4584)
- Plugin: Oriel 0.1.0.0 with the integration on
- Devices: iPhone 17 Pro on iOS 26.6.2 (Safari, Jellyfin for iOS 1.8.0); Samsung Galaxy S23 FE on Android 14 (Jellyfin for Android 2.7.3)

## Verdicts

PASS when pressing Play (or Resume) on an EPUB opens it in Oriel at `/Oriel/?id=<itemId>`. That other media keep their stock players is not checked here, since the test libraries hold only EPUBs: the launcher tests show the player claims nothing but EPUB books, and the smoke test shows config.json keeps every stock player.

| Check | Verdict | OS | Device | Server | App | Observed |
|---|---|---|---|---|---|---|
| takeover-webkit | PASS | n/a (Windows 11) | Playwright 1.64.1 WebKit | Jellyfin 12.2.0 | n/a | scripts/smoke-plugin.sh: integration off, index.html and config.json byte-for-byte stock and Play opens the built-in book player; integration on, Play opens /Oriel/?id=<id> and the book renders, at the root and under /jf |
| takeover-safari | PASS | iOS 26.6.2 | iPhone 17 Pro | Jellyfin 12.2.0 | n/a | Play on The Pillars of the Earth opened /Oriel/?id=<id> in Safari, not the built-in reader |
| takeover-ios-app | PASS | iOS 26.6.2 | iPhone 17 Pro | Jellyfin 12.2.0 | Jellyfin for iOS 1.8.0 | after a force-quit so the app reloaded the web client, Play opened Oriel inside the app; before the integration, the same Play opened the built-in reader |
| takeover-android-app | PASS | Android 14 | Samsung Galaxy S23 FE | Jellyfin 12.2.0 | Jellyfin for Android 2.7.3 | Play opened Oriel inside the app |
| resume-webkit | PASS | n/a (Windows 11) | Playwright 1.64.1 WebKit | Jellyfin 12.2.0 | n/a | scripts/smoke-plugin.sh with saved progress, so the play button reads Resume: integration off, Resume opens the built-in book player; integration on, Resume opens /Oriel/?id=<id>, at the root and under /jf |
| resume-safari | PASS | iOS 26.6.2 | iPhone 17 Pro | Jellyfin 12.2.0 | n/a | with 60% saved on The Pillars of the Earth, the detail page shows the progress and the Resume button opens Oriel, at the start of the book |
| resume-ios-app | PASS | iOS 26.6.2 | iPhone 17 Pro | Jellyfin 12.2.0 | Jellyfin for iOS 1.8.0 | same as Safari: Resume opens Oriel inside the app, at the start of the book |
| resume-android-app | PASS | Android 14 | Samsung Galaxy S23 FE | Jellyfin 12.2.0 | Jellyfin for Android 2.7.3 | same as Safari: Resume opens Oriel inside the app, at the start of the book |

Resume behaves like Play: jellyfin-web picks the player the same way, by asking each player in priority order whether it can play the item, and the resume rows confirm it on every surface. Oriel opens at the start of the book for now, because it does not yet read the position Jellyfin passes in (`startPositionTicks`) or stores.

A browser tab opened before the integration was turned on keeps the page it loaded, so it still opens the built-in reader, at the saved position, until it is reloaded. Desktop Chrome did this until a hard reload, after which Resume opened Oriel.

## Consequence for MVP

Player takeover works on every surface checked, so it is the launch path for MANIFEST.md Major Features #8: with the integration on, Play on an EPUB opens Oriel in the browser and in both official mobile apps, which load books through jellyfin-web rather than a native reader. A Read button is not needed to launch Oriel. The reader at `/Oriel/` stays usable without the integration, so standalone links remain the fallback when File Transformation is not installed or a jellyfin-web release breaks the takeover.

The takeover depends on File Transformation, a third-party plugin, and on jellyfin-web keeping its `config.json` plugin list and `window`-named player loading. Each Jellyfin upgrade needs the smoke test's takeover pass rerun against the new image before the integration is turned on.
