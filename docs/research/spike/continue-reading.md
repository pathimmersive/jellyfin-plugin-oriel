# Progress in Jellyfin's Continue Reading

MANIFEST.md Known Unknowns #4: does Continue Reading pick up books whose progress is written through `/UserItems/{id}/UserData` without a runtime set? This note records what Jellyfin 12.2 does with a reading position written there, and what that means for mirroring Oriel's position into Jellyfin.

## How jellyfin-web 12.2 stores a book position

Read from the bundle that ships in the `jellyfin/jellyfin:12.2.20261005-225228` image, under `/jellyfin/jellyfin-web`:

- The built-in book player reports a one-second timeline: `duration()` is 1000 ms and `currentTime()` is `1000 x progress`, so a position reaches the server as `progress x 10^7` ticks. On Resume it opens `cfiFromPercentage(startPositionTicks / 1e7)`, after building locations every 1024 characters.
- The home page's Continue Reading section (`resumebook`, on by default) lists `/UserItems/Resume` items of type Book.
- On a detail page, the play button's title becomes Resume once `UserData.PlaybackPositionTicks` is above 0.

## What the server does

The question assumed books have no runtime. On Jellyfin 12.2, EPUBs do: the library scan gives each one `RunTimeTicks = 10000000`, the same one-second timeline the built-in player uses. That held for the generated test book and for all 144 EPUBs in the development library. Other formats differ there: the 62 MOBI and AZW3 files have no runtime, and the one PDF has 3,400,000 ticks. Oriel reads only EPUB. So a position written as `round(fraction x 10^7)` ticks is a fraction of the book's runtime, and the server treats it like any other partly played item.

## Setup

- Server: Jellyfin 12.2.0 (`jellyfin/jellyfin:12.2.20261005-225228`) in the throwaway smoke container
- Book: the smoke test's generated EPUB, four chapters of about 3,000 characters each, never opened in the built-in player before the write
- Write: `POST /UserItems/{id}/UserData` with `{"PlaybackPositionTicks": 6000000}`, that is 0.6, inside chapter three
- Browser: Playwright 1.64.1 WebKit on Windows 11

## Verdicts

| Check | Verdict | OS | Device | Server | App | Observed |
|---|---|---|---|---|---|---|
| resume-api | PASS | n/a (Windows 11) | smoke test, curl | Jellyfin 12.2.0 | n/a | before the write, /UserItems/Resume (mediaTypes=Book and includeItemTypes=Book) does not list the book; after writing PlaybackPositionTicks=6000000 alone, both list it. The item has RunTimeTicks=10000000 from the scan |
| played-percentage | PASS | n/a (Windows 11) | smoke test, curl | Jellyfin 12.2.0 | n/a | writing ticks alone, GET UserData returns PlaybackPositionTicks=6000000, PlayedPercentage=60, Played=false; writing PlayedPercentage=60 as well returns the same. The server derives the percentage from ticks and the scan-time runtime |
| continue-reading-row | PASS | n/a (Windows 11) | Playwright 1.64.1 WebKit | Jellyfin 12.2.0 | n/a | the home page's Continue Reading row shows a card for the book |
| builtin-resume | PASS | n/a (Windows 11) | Playwright 1.64.1 WebKit | Jellyfin 12.2.0 | n/a | the detail page's play button reads Resume; pressing it opens the built-in book player showing chapter three's first line |

The smoke test was seen failing on two known-bad inputs: without the write, Resume does not list the book; and expecting chapter four, the built-in player's Resume check fails because chapter three is shown.

## Consequence for MVP

The progress mirror needs only a user-data write. Writing `PlaybackPositionTicks = round(fraction x 10^7)` to `/UserItems/{id}/UserData` (or `IUserDataManager.SaveUserData` server side) puts the book in Continue Reading, sets the percentage Jellyfin shows, and makes the built-in reader resume in the same chapter. No fake runtime, no `PlayedPercentage` in the write, and no `Sessions/Playing` reports are needed.

The mirror relies on the library scan's 10^7-tick runtime for books. If a later Jellyfin release changes it, ticks would no longer read as a fraction; the smoke test asserts that runtime, so an upgrade that changes it fails there first. Position within a chapter is approximate in the built-in reader, which resumes at a 1024-character location; Oriel's exact position stays in its own store.
