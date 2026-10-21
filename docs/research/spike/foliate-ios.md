# foliate-js performance and text selection on iOS

MANIFEST.md Known Unknowns #2. iOS Safari is not an official foliate-js target, and CSS-column pagination can stutter on large chapters. Long-press selection may also fight the paginator inside its iframes. This note records what was measured on a real iPhone with the reader's `?debug=1` overlay, against the bar below.

## Setup

- Server: Jellyfin 12.2.0, local development server over plain http on the same Wi-Fi
- Plugin: Oriel 0.1.0.0, reader built on foliate-js 78914aef, paged layout
- Books, personal copies, not committed:
  - *The Pillars of the Earth*: 8 MB EPUB, 42 documents, largest chapter 199 KB. Tests big-chapter page turns.
  - *Complete Works of Jules Verne (Illustrated)*: 100 MB EPUB, 2,488 documents, largest 237 KB. Tests open time and memory.
- Device: iPhone 17 Pro, iOS 26.6.2
- Jellyfin iOS app: 1.8.0

## Bar

| Check | PASS when |
|---|---|
| pillars-open | first page within 3 s of the download finishing |
| pillars-swipe | page turns within a chapter show no frame over 100 ms |
| pillars-chapter | a turn into the next chapter takes 1 s or less |
| omnibus-open | first page within 10 s of the download finishing, without the page reloading |
| selection | a long-press selects a word, dragging the handles extends it across lines, and the page does not turn |

The overlay reports the download time, the first-page time after download, and for the last page turn: the time from touch end to the view settling, frames over 50 ms, and the worst frame.

## Verdicts

| Check | Verdict | iOS | Device | Server | App | Observed |
|---|---|---|---|---|---|---|
| pillars-open-safari | PASS | 26.6.2 | iPhone 17 Pro | Jellyfin 12.2.0 | n/a | first page 848 ms after download |
| pillars-open-app | PASS | 26.6.2 | iPhone 17 Pro | Jellyfin 12.2.0 | 1.8.0 | first page 23 ms after download, as read off the overlay |
| pillars-swipe-safari | PASS | 26.6.2 | iPhone 17 Pro | Jellyfin 12.2.0 | n/a | worst frame 17 ms; turns felt smooth |
| pillars-swipe-app | PASS | 26.6.2 | iPhone 17 Pro | Jellyfin 12.2.0 | 1.8.0 | worst frame 17 ms; turns felt smooth |
| pillars-chapter-safari | PASS | 26.6.2 | iPhone 17 Pro | Jellyfin 12.2.0 | n/a | last turn 2–5 ms across chapter boundaries, consistently |
| pillars-chapter-app | PASS | 26.6.2 | iPhone 17 Pro | Jellyfin 12.2.0 | 1.8.0 | last turn 2–5 ms across chapter boundaries, consistently |
| omnibus-open-safari | PASS | 26.6.2 | iPhone 17 Pro | Jellyfin 12.2.0 | n/a | first page 6,074 ms after download; no reload; worst frame 35 ms on later turns, felt smooth |
| omnibus-open-app | PASS | 26.6.2 | iPhone 17 Pro | Jellyfin 12.2.0 | 1.8.0 | first page 7,244 ms after download; no reload; worst frame 35 ms on later turns, felt smooth |
| selection-safari | FAIL | 26.6.2 | iPhone 17 Pro | Jellyfin 12.2.0 | n/a | long-press selects one word; dragging a handle turns the page instead of extending the selection |
| selection-app | FAIL | 26.6.2 | iPhone 17 Pro | Jellyfin 12.2.0 | 1.8.0 | long-press selects one word; dragging a handle turns the page instead of extending the selection |

For comparison, the built-in Jellyfin 12 reader on the same server did not open the Verne omnibus: it stayed on its loading screen for several minutes.

### Reading the turn numbers

The turn time runs from touch end to the view's next `relocate`. The paginator scrolls under the finger during the swipe and reports the new position as soon as its snap starts, so the figure does not include the snap animation. It shows that a chapter crossing does no blocking work after the finger lifts. It is not the time the page takes to look settled. The frame figures and the tester's eye cover that part: no frame over 35 ms anywhere, and no visible stutter.

### Why selection fails

`paginator.js` listens for `touchmove` on every section document and, for any single-finger move, calls `preventDefault()` and scrolls the view by the finger's movement. It does not check whether a selection is active. Dragging a selection handle is a single-finger move, so the paginator takes it as a swipe. The pointer and keyboard selection handling in the same file never runs for this case.

## Consequence for MVP

foliate-js stays as the engine. On iOS it opens an 8 MB novel in under a second and a 100 MB, 2,488-document omnibus in 6–7 s with no reload, in Safari and in the Jellyfin app, and page turns stay smooth in both books.

Text selection does not work as shipped, and highlights and notes (MANIFEST.md Major Features #5) depend on it. Before annotation work starts, the reader needs to keep a touch from turning the page while a non-collapsed selection is active in the section document, for example with a capture-phase `touchmove` listener in the engine that stops the paginator's handler. This belongs in the engine module, not in the vendored copy, so the foliate-js pin stays clean.
