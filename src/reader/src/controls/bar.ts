import type { Bookmarks } from './bookmarks'
import { element } from './elements'
import { icon, ICONS } from './icons'
import { pagesLeftName, percent, type ProgressShown } from './progress'

/** What the header and the footers show, and where they lead. */
export interface BarOptions {
    /** The book's title, for the header. */
    title: string
    /** The book's details page in jellyfin-web. */
    detailsUrl: string
    bookmarks: Bookmarks
    /** Goes to a fraction of the book, as a reader move. */
    seek(fraction: number): Promise<void>
    /** Turns a page back or forward, from the arrows at a desktop's edges. */
    turnPage(direction: 'prev' | 'next'): void
    /** Whether the place shown is the book's first page, and its last. */
    edges(): { start: boolean, end: boolean }
    /** Whether the pages scroll. */
    scrolling(): boolean
}

/** The reading footer, and the header, footer and arrows of the controls. */
export interface Bar {
    /** The footer shown while reading. */
    reading: HTMLElement
    /** The header, the footer and the arrows. */
    bar: HTMLElement
    contentsButton: HTMLButtonElement
    prefsButton: HTMLButtonElement
    moreButton: HTMLButtonElement
    /** The arrows read as the page turns, and hide at the book's ends and while a panel is open. */
    showArrows(panelOpen: boolean): void
    /** The bookmark beside the progress, in both footers, shows whether the page is bookmarked. */
    showBookmark(): void
    /** The place now shown, as `Controls.locate` has it. */
    locate(chapter: string, fraction: number, progress: ProgressShown, left: number | null): void
}

interface PlaceRow {
    row: HTMLElement
    chapter: HTMLElement
    counting: HTMLElement
    progress: HTMLElement
    left: HTMLElement
    bookmark: HTMLButtonElement
}

// The chapter, the progress, the pages left in the chapter and the bookmark, as both footers show them.
const placeRow = (): PlaceRow => {
    const row = element('div', { class: 'place' })
    const chapter = element('span', { class: 'chapter' })
    const counting = element('span', { class: 'counting' })
    counting.textContent = 'Counting pages'
    counting.hidden = true
    const progress = element('span', { class: 'progress' })
    const left = element('span', { class: 'left', role: 'img' }, `<span class="count"></span>${icon(ICONS.toEnd)}`)
    left.hidden = true
    const status = element('span', { class: 'status' })
    status.append(counting, progress, left)
    const bookmark = element('button', { type: 'button', class: 'bookmark', 'aria-pressed': 'false', 'aria-label': 'Bookmark this page' }, icon(ICONS.bookmarkOff))
    row.append(chapter, status, bookmark)
    return { row, chapter, counting, progress, left, bookmark }
}

// Full screen, at the end of the footer on a desktop, where the browser allows it.
const fullScreenButton = (): HTMLButtonElement => {
    const fullScreen = element('button', { type: 'button', class: 'icon-button full-screen', 'aria-label': 'Full screen' }, icon(ICONS.fullScreen))
    fullScreen.hidden = !document.fullscreenEnabled
    fullScreen.addEventListener('click', () => {
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
        else void document.documentElement.requestFullscreen().catch(() => {})
    })
    document.addEventListener('fullscreenchange', () => {
        const full = document.fullscreenElement !== null
        fullScreen.setAttribute('aria-label', full ? 'Leave full screen' : 'Full screen')
        fullScreen.innerHTML = icon(full ? ICONS.leaveFullScreen : ICONS.fullScreen)
    })
    return fullScreen
}

export const createBar = (options: BarOptions): Bar => {
    const reading = placeRow()
    reading.row.id = 'reading-footer'

    const back = element('a', { class: 'icon-button', href: options.detailsUrl, 'aria-label': 'Back to the book in Jellyfin' }, icon(ICONS.back))
    const title = element('span', { class: 'title' })
    title.textContent = options.title
    const contentsButton = element('button', { type: 'button', class: 'icon-button', 'aria-label': 'Contents', 'aria-expanded': 'false', 'aria-controls': 'contents' }, icon(ICONS.toc))
    const prefsButton = element('button', { type: 'button', class: 'icon-button', 'aria-label': 'Preferences', 'aria-expanded': 'false', 'aria-controls': 'prefs' }, icon(ICONS.prefs))
    const moreButton = element('button', { type: 'button', class: 'icon-button', 'aria-label': 'More', 'aria-haspopup': 'true', 'aria-expanded': 'false', 'aria-controls': 'more' }, icon(ICONS.more))
    const header = element('header')
    header.append(back, title, contentsButton, prefsButton, moreButton)

    const place = placeRow()
    place.row.append(fullScreenButton())
    const slider = element('input', { type: 'range', min: '0', max: '100', step: 'any', value: '0', 'aria-label': 'Position in the book' })
    const footer = element('footer')
    footer.append(place.row, slider)
    // The percent follows the slider while it moves; the book moves on release.
    slider.addEventListener('input', () => { place.progress.textContent = percent(Number(slider.value) / 100) })
    slider.addEventListener('change', () => { void options.seek(Number(slider.value) / 100) })

    // On a desktop, arrows at the edges turn the page while the controls show.
    const previous = element('button', { type: 'button', class: 'page-arrow previous' }, icon(ICONS.previous))
    const next = element('button', { type: 'button', class: 'page-arrow next' }, icon(ICONS.next))
    previous.addEventListener('click', () => options.turnPage('prev'))
    next.addEventListener('click', () => options.turnPage('next'))

    const bar = element('div', { id: 'controls', 'data-controls': '' })
    bar.append(header, footer, previous, next)

    const rows = [reading, place]
    // What the bookmarks show, so a page turn that leaves it as it was changes nothing.
    let markedShown = false
    for (const { bookmark } of rows) bookmark.addEventListener('click', () => { void options.bookmarks.toggle() })
    return {
        reading: reading.row,
        bar,
        contentsButton,
        prefsButton,
        moreButton,
        showArrows(panelOpen) {
            const scrolling = options.scrolling()
            previous.setAttribute('aria-label', scrolling ? 'Scroll up' : 'Previous page')
            next.setAttribute('aria-label', scrolling ? 'Scroll down' : 'Next page')
            const { start, end } = options.edges()
            previous.hidden = panelOpen || start
            next.hidden = panelOpen || end
        },
        showBookmark() {
            const marked = options.bookmarks.marked()
            if (marked === markedShown) return
            markedShown = marked
            for (const { bookmark } of rows) {
                bookmark.setAttribute('aria-pressed', String(marked))
                bookmark.setAttribute('aria-label', marked ? 'Remove the bookmark on this page' : 'Bookmark this page')
                bookmark.innerHTML = icon(marked ? ICONS.bookmarkOn : ICONS.bookmarkOff)
            }
        },
        locate(chapter, fraction, progress, left) {
            for (const row of rows) {
                row.chapter.textContent = chapter
                row.counting.hidden = !progress.counting
                row.progress.textContent = progress.text
                row.left.hidden = left === null
                if (left !== null) {
                    row.left.querySelector('.count')!.textContent = String(left)
                    row.left.setAttribute('aria-label', pagesLeftName(left))
                }
            }
            slider.value = String(fraction * 100)
        },
    }
}
