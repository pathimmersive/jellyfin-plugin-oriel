# Does the reader work inside the official Jellyfin iOS app?

MANIFEST.md Known Unknowns #1. No 2026 source confirms that the official Jellyfin iOS app loads the server-hosted web UI or shares its localStorage with Safari. This note records what was observed on a real iPhone with the Oriel plugin installed.

Observed 2026-10-21 by John Greaux.

## Setup

- Server: Jellyfin 12.2.0 (`jellyfin/jellyfin:12.2.20261005-225228`) in Docker Desktop on a Windows PC, reached over the home Wi-Fi at plain `http://<LAN address>:8096`. This was a development server, not a production one.
- Plugin: Oriel 0.1.0.0, reader built on foliate-js 78914aef.
- Library: a books library holding a sample of a real personal library (standalone and series EPUBs).
- Device: iPhone 17 Pro, iOS 26.6.2.
- Jellyfin iOS app: 1.8.0.

## Verdicts

PASS means the book rendered with no second login. FAIL means it did not; the observation says what happened instead.

| Surface | Verdict | iOS | Device | Server | App | Observed |
|---|---|---|---|---|---|---|
| safari | PASS | 26.6.2 | iPhone 17 Pro | 12.2.0 | n/a | Signed in to jellyfin-web in Safari, then opened /Oriel/?id=<itemId>: the book rendered with no login prompt |
| home-screen | FAIL | 26.6.2 | iPhone 17 Pro | 12.2.0 | n/a | Launching the home-screen icon redirected to the Jellyfin login page: the home-screen web app does not see Safari's session |
| ios-app | PASS | 26.6.2 | iPhone 17 Pro | 12.2.0 | 1.8.0 | A link to /Oriel/?id=<itemId> in a book's Overview opened Oriel inside the app, which reused the app's session and rendered the book (after the device id fix below) |

### Safari

The reader found the jellyfin-web credentials in Safari's localStorage on the server's origin, downloaded the book through `/Items/{id}/Download`, and rendered the first page. No second login.

### Home-screen web app

iOS gives a web app added to the home screen its own storage, separate from Safari's. The reader found no credentials and sent the user to `/web/#/login`, as designed. Signing in there works, but jellyfin-web then opens its home page rather than returning to the book, so the user has to find the book again. Once signed in, the web app keeps its own session.

### Official Jellyfin iOS app

The app loads the server-hosted jellyfin-web in a web view on the server's origin, and pages under that origin share its localStorage. A link to `/Oriel/` (here, in a book's Overview) opens Oriel inside the app, and Oriel finds the app's session. The app's own book button still opens Jellyfin's built-in reader. There is no supported way to change that button or add a menu link without the optional jellyfin-web integration.

The first attempt failed with `TypeError: crypto.randomUUID is not a function`. `crypto.randomUUID` exists only in secure contexts (HTTPS or localhost), and the server was plain http. Safari did not hit this because jellyfin-web's own device id was in storage there. The app supplies its device id natively, so the reader generated one. The reader now generates its device id with `crypto.getRandomValues`, and the book renders.

## Consequence for MVP

The official iOS app is a real reading surface: Oriel runs inside it with the app's session, so the MVP does not have to tell users to switch to Safari. What the app lacks is a way in. The app's book button opens the built-in reader, so entry-point work (a "Read" button or taking over the book player through jellyfin-web, Known Unknown #3) has a direct payoff and stays in MVP scope, depending on what that spike finds. Until then, a link in a book's Overview is a working manual entry point.

Safari remains the surface that works with no setup. The home-screen web app needs one sign-in of its own, and the reader should bring the user back to the book after that sign-in.

The reader must not depend on secure-context-only browser APIs (`crypto.randomUUID`, `crypto.subtle`, service workers, the async clipboard). Household servers are often reached over plain http.
