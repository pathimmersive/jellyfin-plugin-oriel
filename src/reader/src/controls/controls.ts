import { type FontChoice, FONTS, type FontName, fontStack, INDENT, MAX_THEMES, ownFamilyOf, ownFont, ownTheme, type OwnTheme, ownThemeOf, type PageTurn, type Progress, LINE_SPACING, MARGIN, marginsFor, PARAGRAPH_SPACING, type Range, resetLayout, type Settings, SIDES, SIZE, startingColours, stepIn, stepSize, type ThemeChoice, themeShown, THEMES, type ThemeId } from '../settings/settings'
import { type OwnFonts, stylesOf } from './fonts'
import type { Bookmarks } from './bookmarks'
import type { ContentsRow } from './contents'
import type { HighlighterSheet } from './highlighter-sheet'
import { highlightFill, type Highlighters, MAX_HIGHLIGHTERS, moved } from './highlighters'
import type { Highlights } from './highlights'
import { createHint, hintDue, hintKind, readHintsSeen, sawHint } from './hint'
import { pagesLeftName, percent, type ProgressShown } from './progress'
import { type BookSearch, noMatches } from './search'
import { type ControlsEvent, type ControlsState, HIDDEN, nextControls } from './state'
import { createThemeSheet } from './theme-sheet'
import type { OwnThemes } from './themes'

/** What the controls show and where their links go. */
export interface ControlsOptions {
    /** The book's title, for the header. */
    title: string
    /** The book's details page in jellyfin-web. */
    detailsUrl: string
    /** Your reading data for this book. */
    dataUrl: string
    /** Goes to a fraction of the book, as a reader move. */
    seek(fraction: number): Promise<void>
    /** The Contents panel's rows, with the entry being read marked. */
    contents(): ContentsRow[]
    /** Goes to a contents entry's link, as a reader move. */
    choose(href: string): Promise<void>
    /** Search in this book, for a book with text; null for comics and PDFs. */
    search: BookSearch | null
    /** The book's bookmarks. */
    bookmarks: Bookmarks
    /** The book's highlights, for a book with text; null for comics and PDFs. */
    highlights: Highlights | null
    /** The reader's highlighters and the sheet that adds and edits them, with the highlights. */
    highlighters: Highlighters | null
    highlighterSheet: HighlighterSheet | null
    /** The reader's own fonts, kept on the server. */
    fonts: OwnFonts
    /** The reader's own themes, kept on the server. */
    themes: OwnThemes
    /** The settings the reader opened with. */
    settings: Settings
    /** True for comics and PDFs, whose pages have no text to restyle. */
    fixedLayout: boolean
    /** True on a screen wider than a phone's, whose margins start wider. */
    wide(): boolean
    /** True when the reader reads by touch, whose reading gestures are taps and swipes: the last input, else the primary pointer. */
    touch(): boolean
    /** Where this device remembers the reading gestures hints it has dismissed. */
    storage: Pick<Storage, 'getItem' | 'setItem'>
    /** Applies and keeps settings chosen in Preferences. */
    change(settings: Settings): void
    /** Turns a page back or forward, from the arrows at a desktop's edges. */
    turnPage(direction: 'prev' | 'next'): void
    /** Whether the place shown is the book's first page, and its last. */
    edges(): { start: boolean, end: boolean }
    /** A panel beside the page (Contents, Preferences, Search) opened or closed. */
    panel(open: boolean): void
}

/** The reader's controls, as the page drives them. */
export interface Controls {
    /** A tap or click in the middle of the page. */
    middle(): void
    /** A page turned by the reader. */
    turned(): void
    /**
     * The place now shown: its chapter's name (empty for none), the fraction
     * of the book, the progress to show, and the pages left in the chapter
     * (null for a book without pages).
     */
    locate(chapter: string, fraction: number, progress: ProgressShown, left: number | null): void
    /** Opens Search in this book with a query, searched at once. */
    search(query: string): void
    /** Fills the Contents panel's tab again, open or not, as when the book has been counted. */
    refill(): void
}

// Material icons, as the canvas draws them.
const ICONS = {
    back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
    more: 'M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
    data: 'M9 3L5 6.99h3V14h2V6.99h3L9 3zm7 14.01V10h-2v7.01h-3L15 21l4-3.99h-3z',
    info: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z',
    toc: 'M3 9h14V7H3v2zm0 4h14v-2H3v2zm0 4h14v-2H3v2zm16 0h2v-2h-2v2zm0-10v2h2V7h-2zm0 6h2v-2h-2v2z',
    close: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    prefs: 'M5 3h2v6H5zM5 13h2v8H5zM3 9h6v4H3zM11 3h2v2h-2zM11 9h2v12h-2zM9 5h6v4H9zM17 3h2v10h-2zM17 17h2v4h-2zM15 13h6v4h-6z',
    down: 'M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z',
    up: 'M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6 1.41 1.41z',
    reset: 'M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z',
    toEnd: 'M5.59 7.41L10.18 12l-4.59 4.59L7 18l6-6-6-6zM16 6h2v12h-2z',
    gesture: 'M9 11.24V7.5C9 6.12 10.12 5 11.5 5S14 6.12 14 7.5v3.74c1.21-.81 2-2.18 2-3.74C16 5.01 13.99 3 11.5 3S7 5.01 7 7.5c0 1.56.79 2.93 2 3.74zm9.84 4.63l-4.54-2.26c-.17-.07-.35-.11-.54-.11H13v-6c0-.83-.67-1.5-1.5-1.5S10 6.67 10 7.5v10.74l-3.43-.72c-.08-.01-.15-.03-.24-.03-.31 0-.59.13-.79.33l-.79.8 4.94 4.94c.27.27.65.44 1.06.44h6.79c.75 0 1.33-.55 1.44-1.28l.75-5.27c.01-.07.02-.14.02-.2 0-.62-.38-1.16-.91-1.38z',
    slide: 'M4 6h2v12H4zm4 0h12v12H8z',
    scroll: 'M12 4l-4 4h3v8H8l4 4 4-4h-3V8h3z',
    fade: 'M12 3a9 9 0 100 18 9 9 0 000-18zm0 16V5a7 7 0 010 14z',
    none: 'M6 5h12v14H6z',
    bookmarkOff: 'M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2zm0 15l-5-2.18L7 18V5h10v13z',
    bookmarkOn: 'M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z',
    trash: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
    upload: 'M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z',
    search: 'M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
    note: 'M3 18h12v-2H3v2zM3 6v2h18V6H3zm0 7h18v-2H3v2z',
    drag: 'M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
    edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
    plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
    previous: 'M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z',
    next: 'M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z',
    fullScreen: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
    leaveFullScreen: 'M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z',
    highlight: 'M22 24H2v-4h20v4zM13.06 5.19l3.75 3.75L7.75 18H4v-3.75l9.06-9.06zm4.82 2.68l-3.75-3.75 1.83-1.83c.39-.39 1.02-.39 1.41 0l2.34 2.34c.39.39.39 1.02 0 1.41l-1.83 1.83z',
}

// The page turns: the setting, its name and its icon, as the canvas draws them.
const PAGE_TURN_CHOICES: [PageTurn, string, keyof typeof ICONS][] = [
    ['slide', 'Slide', 'slide'],
    ['scroll', 'Scroll', 'scroll'],
    ['fade', 'Fade', 'fade'],
    ['none', 'None', 'none'],
]

// The Progress choices: the setting and its name.
const PROGRESS_CHOICES: [Progress, string][] = [['percent', 'Percentage'], ['pages', 'Pages']]

// The spacing steppers: the setting, its name, its range and how its value reads.
type Spacing = 'lineSpacing' | 'paragraphSpacing' | 'indent'
const SPACINGS: [Spacing, string, Range, (value: number) => string][] = [
    ['lineSpacing', 'Line spacing', LINE_SPACING, value => value.toFixed(1)],
    ['paragraphSpacing', 'Paragraph spacing', PARAGRAPH_SPACING, value => `${value.toFixed(1)} em`],
    ['indent', 'Indent', INDENT, value => `${value.toFixed(1)} em`],
]

// The checkboxes: the setting and its label.
type Check = 'justify' | 'hyphenate' | 'bookLayout'
const CHECKS: [Check, string][] = [
    ['justify', 'Justify text'],
    ['hyphenate', 'Hyphenate words'],
    ['bookLayout', "Use the book's layout and fonts"],
]

const icon = (path: string): string =>
    `<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="${path}"/></svg>`

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Record<string, string> = {}, html = ''): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag)
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value)
    node.innerHTML = html
    return node
}

// A stepper's value between its Less and More buttons, with its name before them.
const stepper = (setting: string, name: string, down: HTMLButtonElement, up: HTMLButtonElement, className = 'stepper'): { row: HTMLElement, value: HTMLElement } => {
    const row = element('div', { class: className, 'data-setting': setting })
    const label = element('span', { class: 'stepper-name' })
    label.textContent = name
    const value = element('span', { class: 'value' })
    const controls = element('div', { class: 'stepper-controls' })
    controls.append(down, value, up)
    row.append(label, controls)
    return { row, value }
}

const stepButton = (label: string, path: string): HTMLButtonElement =>
    element('button', { type: 'button', class: 'step', 'aria-label': label }, icon(path))

const closeButton = (): HTMLButtonElement =>
    element('button', { type: 'button', class: 'icon-button', 'aria-label': 'Close' }, icon(ICONS.close))

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

/**
 * Adds the reader's controls to `root`: a reading footer shown while reading,
 * and the header, footer and More shown by a tap in the middle of the page.
 */
export const createControls = (root: HTMLElement, options: ControlsOptions): Controls => {
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
    // Full screen, at the end of the footer on a desktop, where the browser allows it.
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
    place.row.append(fullScreen)
    const slider = element('input', { type: 'range', min: '0', max: '100', step: 'any', value: '0', 'aria-label': 'Position in the book' })
    const footer = element('footer')
    footer.append(place.row, slider)

    // On a desktop, arrows at the edges turn the page while the controls show.
    const previous = element('button', { type: 'button', class: 'page-arrow previous' }, icon(ICONS.previous))
    const next = element('button', { type: 'button', class: 'page-arrow next' }, icon(ICONS.next))
    previous.addEventListener('click', () => options.turnPage('prev'))
    next.addEventListener('click', () => options.turnPage('next'))

    const bar = element('div', { id: 'controls', 'data-controls': '' })
    bar.append(header, footer, previous, next)

    const backdrop = element('div', { id: 'more-backdrop', 'data-controls': '' })
    const more = element('nav', { id: 'more', 'data-controls': '', 'aria-label': 'More' })
    const link = (href: string, path: string, name: string): HTMLAnchorElement => {
        const a = element('a', { href }, `${icon(path)}<span></span>`)
        a.querySelector('span')!.textContent = name
        return a
    }
    const showGestures = element('button', { type: 'button' }, `${icon(ICONS.gesture)}<span>Show reading gestures</span>`)
    const searchItem = element('button', { type: 'button' }, `${icon(ICONS.search)}<span>Search in this book</span>`)
    if (options.search) more.append(searchItem)
    more.append(link(options.dataUrl, ICONS.data, 'Your reading data'), showGestures, link(options.detailsUrl, ICONS.info, 'Book details in Jellyfin'))

    // Contents: a sheet over a dimmed page on a phone, a panel beside the page
    // on a wider screen, with a tab for the book's contents, one for its
    // bookmarks and, in a book with text, one for its highlights.
    const contentsBackdrop = element('div', { id: 'contents-backdrop', 'data-controls': '' })
    const contents = element('section', { id: 'contents', 'data-controls': '', 'aria-label': 'Contents' })
    const contentsTitle = element('h2')
    contentsTitle.textContent = options.title
    const close = closeButton()
    const contentsHeader = element('div', { class: 'panel-header' })
    contentsHeader.append(contentsTitle, close)
    const contentsBody = element('div', { class: 'panel-body', id: 'contents-list', role: 'tabpanel', 'aria-labelledby': 'tab-contents' })
    const bookmarksBody = element('div', { class: 'panel-body bookmarks', id: 'bookmarks-list', role: 'tabpanel', 'aria-labelledby': 'tab-bookmarks' })
    const highlightsBody = element('div', { class: 'panel-body highlights', id: 'highlights-list', role: 'tabpanel', 'aria-labelledby': 'tab-highlights' })
    const tabList = element('div', { role: 'tablist', class: 'tabs' })
    type Tab = 'contents' | 'bookmarks' | 'highlights'
    const tabChoices: [Tab, string, HTMLElement][] = [['contents', 'Contents', contentsBody], ['bookmarks', 'Bookmarks', bookmarksBody]]
    if (options.highlights) tabChoices.push(['highlights', 'Highlights', highlightsBody])
    const tabs = tabChoices.map(([name, label, body]) => {
        const tab = element('button', { type: 'button', role: 'tab', id: `tab-${name}`, 'aria-controls': body.id, 'aria-selected': 'false' })
        tab.textContent = label
        tab.addEventListener('click', () => chooseTab(name))
        tabList.append(tab)
        return { name, tab, body }
    })
    let tabShown: Tab = 'contents'
    contents.append(contentsHeader, tabList, ...tabs.map(({ body }) => body))
    const fillContents = (): void => {
        const rows = options.contents()
        if (!rows.length) {
            contentsBody.replaceChildren(element('p', { class: 'empty' }, `${icon(ICONS.toc)}<span>This book has no table of contents.</span>`))
            return
        }
        const list = element('ol')
        for (const row of rows) {
            const entry = element(row.href ? 'a' : 'span', { class: 'entry', style: `--depth: ${row.depth}` }, '<span class="label"></span><span class="where"></span>')
            entry.querySelector('.label')!.textContent = row.label
            entry.querySelector('.where')!.textContent = row.where
            if (row.href) {
                entry.setAttribute('href', '#')
                entry.addEventListener('click', event => {
                    event.preventDefault()
                    apply('chosen')
                    void options.choose(row.href)
                })
            }
            if (row.current) entry.setAttribute('aria-current', 'true')
            const item = element('li')
            item.append(entry)
            list.append(item)
        }
        contentsBody.replaceChildren(list)
    }
    const fillBookmarks = (): void => {
        const rows = options.bookmarks.rows()
        if (!rows.length) {
            bookmarksBody.replaceChildren(element('div', { class: 'empty' },
                `${icon(ICONS.bookmarkOff)}<p>No bookmarks in this book yet.</p><p class="hint">Tap the bookmark beside the progress to mark a page.</p>`))
            return
        }
        const list = element('ul')
        for (const row of rows) {
            const item = element('li')
            const entry = element('a', { href: '#', class: 'entry' }, '<span class="text"></span><span class="where"></span>')
            entry.querySelector('.text')!.textContent = row.text
            entry.querySelector('.where')!.textContent = row.where
            entry.addEventListener('click', event => {
                event.preventDefault()
                apply('chosen')
                void options.bookmarks.go(row.id)
            })
            const remove = element('button', { type: 'button', class: 'icon-button', 'aria-label': 'Remove this bookmark' }, icon(ICONS.trash))
            remove.addEventListener('click', () => { void options.bookmarks.remove(row.id) })
            item.append(entry, remove)
            list.append(item)
        }
        bookmarksBody.replaceChildren(list)
    }
    // The highlights of the colour chosen (all for null), under chips choosing it.
    let colourShown: string | null = null
    const fillHighlights = (): void => {
        const highlights = options.highlights
        const highlighters = options.highlighters
        if (!highlights || !highlighters) return
        if (colourShown && !highlighters.list().some(highlighter => highlighter.id === colourShown)) colourShown = null
        if (!highlights.rows(null).length) {
            highlightsBody.replaceChildren(element('div', { class: 'empty' },
                `${icon(ICONS.highlight)}<p>No highlights in this book yet.</p><p class="hint">Select text to highlight it or add a note.</p>`))
            return
        }
        const chips = element('div', { role: 'group', class: 'chips', 'aria-label': 'Show highlights of one colour' })
        for (const [colour, name, solid] of [[null, 'All', ''] as const, ...highlighters.list().map(each => [each.id, each.name, each.solid] as const)]) {
            const chip = element('button', { type: 'button', class: 'chip', 'aria-pressed': String(colour === colourShown) },
                `${solid ? '<span class="dot"></span>' : ''}<span></span>`)
            chip.querySelector<HTMLElement>('.dot')?.style.setProperty('background', solid)
            chip.lastElementChild!.textContent = name
            chip.addEventListener('click', () => {
                colourShown = colour
                fillHighlights()
                highlightsBody.querySelector<HTMLElement>('.chip[aria-pressed="true"]')?.focus()
            })
            chips.append(chip)
        }
        const rows = highlights.rows(colourShown)
        if (!rows.length) {
            const none = element('p', { class: 'none' })
            none.textContent = 'No highlights in this colour.'
            highlightsBody.replaceChildren(chips, none)
            return
        }
        const list = element('ul')
        for (const row of rows) {
            const item = element('li')
            const entry = element('a', { href: '#', class: 'entry' }, '<span class="text"><mark></mark></span><span class="where"></span>')
            if (row.note) {
                const note = element('span', { class: 'note' }, `${icon(ICONS.note)}<span></span>`)
                note.lastElementChild!.textContent = row.note
                entry.querySelector('.where')!.before(note)
            }
            const mark = entry.querySelector('mark')!
            mark.textContent = row.text
            mark.dataset.colour = row.colour
            mark.style.background = highlightFill(highlighters.find(row.colour))
            entry.querySelector('.where')!.textContent = row.where
            entry.addEventListener('click', event => {
                event.preventDefault()
                apply('chosen')
                void highlights.go(row.id)
            })
            const remove = element('button', { type: 'button', class: 'icon-button', 'aria-label': 'Delete this highlight' }, icon(ICONS.trash))
            remove.addEventListener('click', () => { void highlights.remove(row.id) })
            item.append(entry, remove)
            list.append(item)
        }
        highlightsBody.replaceChildren(chips, list)
    }
    // The tab shown last stays shown; only its list is filled.
    const fills: Record<Tab, () => void> = { contents: fillContents, bookmarks: fillBookmarks, highlights: fillHighlights }
    const chooseTab = (name: Tab): void => {
        tabShown = name
        for (const { name: each, tab, body } of tabs) {
            tab.setAttribute('aria-selected', String(each === name))
            body.hidden = each !== name
            if (each !== name) body.replaceChildren()
        }
        fills[name]()
        if (name === 'contents') contentsBody.querySelector('[aria-current]')?.scrollIntoView({ block: 'center' })
    }

    // Search in this book: a sheet or panel like Contents. A search lists each
    // chapter's matches as it is searched, and choosing one goes there.
    const searchBackdrop = element('div', { id: 'search-backdrop', 'data-controls': '' })
    const searchPanel = element('section', { id: 'search', 'data-controls': '', 'aria-label': 'Search in this book' })
    const searchClose = closeButton()
    const searchHeader = element('div', { class: 'panel-header' }, '<h2>Search in this book</h2>')
    searchHeader.append(searchClose)
    const searchForm = element('form', { role: 'search', class: 'search-form' },
        `<label class="field">${icon(ICONS.search)}<span class="visually-hidden">Search in this book</span><input type="search" enterkeyhint="search" autocomplete="off" spellcheck="false"></label>`)
    const searchField = searchForm.querySelector('input')!
    const results = element('div', { class: 'results' })
    const searching = element('p', { class: 'searching', role: 'status' })
    searching.textContent = 'Searching the rest of the book…'
    searching.hidden = true
    const searchBody = element('div', { class: 'panel-body' })
    searchBody.append(searchForm, results, searching)
    searchPanel.append(searchHeader, searchBody)
    // Each search has its number; an older one still running stops at its next section.
    let searchRun = 0
    const clearSearch = (): void => {
        searchRun++
        results.replaceChildren()
        searching.hidden = true
        options.search?.clear()
    }
    const matchItem = (cfi: string, pre: string, match: string, post: string): HTMLLIElement => {
        const item = element('li')
        const go = element('a', { href: '#' }, '<span></span><mark></mark><span></span>')
        const [before, marked, after] = go.children
        before.textContent = pre
        marked.textContent = match
        after.textContent = post
        go.addEventListener('click', event => {
            event.preventDefault()
            apply('chosen')
            void options.search?.go(cfi)
        })
        item.append(go)
        return item
    }
    const runSearch = async (query: string): Promise<void> => {
        const search = options.search
        if (!search) return
        const run = ++searchRun
        results.replaceChildren()
        searching.hidden = false
        let chapter = ''
        let list: HTMLUListElement | null = null
        let found = false
        try {
            for await (const section of search.run(query)) {
                if (run !== searchRun) return
                if (!section.matches.length) continue
                found = true
                // A chapter can span sections: its matches stay under one name.
                if (!list || section.label !== chapter) {
                    chapter = section.label
                    const group = element('div', { class: 'group' })
                    if (chapter) {
                        const name = element('span', { class: 'chapter' })
                        name.textContent = chapter
                        group.append(name)
                    }
                    list = element('ul')
                    group.append(list)
                    results.append(group)
                }
                for (const { cfi, pre, match, post } of section.matches) list.append(matchItem(cfi, pre, match, post))
            }
        } catch (error) {
            console.warn('Oriel: the search stopped', error)
        }
        if (run !== searchRun) return
        searching.hidden = true
        if (!found) {
            const none = element('div', { class: 'no-matches' }, `${icon(ICONS.search)}<p class="what"></p><p class="next">Check the spelling, or search for fewer words.</p>`)
            none.querySelector('.what')!.textContent = noMatches(query)
            results.replaceChildren(none)
        }
    }
    searchForm.addEventListener('submit', event => {
        event.preventDefault()
        const query = searchField.value.trim()
        if (query) void runSearch(query)
        else clearSearch()
    })
    searchField.addEventListener('input', () => {
        if (!searchField.value) clearSearch()
    })

    // Preferences: a sheet or panel like Contents. Each choice applies at once.
    const prefsBackdrop = element('div', { id: 'prefs-backdrop', 'data-controls': '' })
    const prefs = element('section', { id: 'prefs', 'data-controls': '', 'aria-label': 'Preferences' })
    const prefsClose = closeButton()
    // Your fonts, New theme and Edit theme take Preferences' place, with Back before the title.
    const prefsBack = element('button', { type: 'button', class: 'icon-button back', 'aria-label': 'Back', hidden: '' }, icon(ICONS.back))
    const prefsHeader = element('div', { class: 'panel-header' }, '<h2>Preferences</h2>')
    const prefsTitle = prefsHeader.querySelector('h2')!
    prefsHeader.prepend(prefsBack)
    prefsHeader.append(prefsClose)
    const prefsBody = element('div', { class: 'panel-body' }, '<p class="note"></p>')
    prefsBody.querySelector('.note')!.textContent = options.highlighters
        ? 'Your preferences apply to this device. Your highlighters follow you on every device.'
        : 'Your preferences apply to this device.'
    const fontsBody = element('div', { class: 'panel-body your-fonts', hidden: '' },
        '<p class="about">Fonts you add are yours and appear on all your devices. TTF, OTF or WOFF2, up to 5 MB each. Only add fonts you are allowed to use.</p>'
        + `<label class="add-font">${icon(ICONS.upload)}Add a font<input type="file" accept=".ttf,.otf,.woff2"></label>`
        + '<p class="message" role="status"></p><div class="own-fonts"><span class="group-label">Your fonts</span><ul></ul></div>')
    prefs.append(prefsHeader, prefsBody, fontsBody)
    let settings = options.settings
    const group = (name: string): { box: HTMLElement, row: HTMLElement } => {
        const box = element('div', { role: 'group', 'aria-label': name, class: 'choices' })
        const label = element('span', { class: 'group-label' })
        label.textContent = name
        const row = element('div', { class: 'choice-row' })
        box.append(label, row)
        return { box, row }
    }
    const themes = group('Theme')
    // The built-in themes, then the reader's own with an edit badge, then Add
    // while the reader has fewer than 12. A custom theme's card, once chosen,
    // opens Edit theme.
    let themeButtons: HTMLButtonElement[] = []
    const addTheme = element('button', { type: 'button', class: 'theme add', 'aria-label': 'Add a theme' }, '<span class="swatch">+</span><span class="name">Add</span>')
    const themeCard = (choice: ThemeChoice, name: string, label: string, colours: { background: string, text: string }): HTMLButtonElement => {
        const button = element('button', { type: 'button', class: 'theme', 'aria-label': label, 'aria-pressed': 'false', 'data-theme': choice }, '<span class="swatch">Aa</span><span class="name"></span>')
        button.querySelector<HTMLElement>('.swatch')!.style.cssText = `background: ${colours.background}; color: ${colours.text}`
        button.querySelector('.name')!.textContent = name
        return button
    }
    const fillThemeButtons = (): void => {
        const builtIn = (Object.keys(THEMES) as ThemeId[]).map(id => {
            const button = themeCard(id, THEMES[id].name, THEMES[id].name, THEMES[id])
            button.addEventListener('click', () => choose({ theme: id }))
            return button
        })
        const own = options.themes.list().map(theme => {
            const choice = ownTheme(theme.id)
            const button = themeCard(choice, theme.name, `${theme.name}, a custom theme; open it to edit`, theme)
            const badge = element('span', { class: 'badge' }, icon(ICONS.edit))
            badge.style.cssText = `background: ${theme.controls}; color: ${theme.controlsText}`
            button.querySelector('.swatch')!.append(badge)
            button.addEventListener('click', () => {
                if (settings.theme === choice) openTheme(theme)
                else choose({ theme: choice })
            })
            return button
        })
        themeButtons = [...builtIn, ...own]
        addTheme.hidden = own.length >= MAX_THEMES
        themes.row.replaceChildren(...themeButtons, addTheme)
    }
    fillThemeButtons()
    const fonts = group('Font')
    // The bundled fonts, then the reader's own families, then Add font.
    let fontButtons: HTMLButtonElement[] = []
    const addFont = element('button', { type: 'button', class: 'font add', 'aria-label': 'Add font' }, `${icon(ICONS.upload)}Add font`)
    const fillFontButtons = (): void => {
        const builtIn = (Object.keys(FONTS) as FontName[]).map(name => ({ name, choice: name as FontChoice, own: false }))
        const own = options.fonts.families().map(family => ({ name: family.name, choice: ownFont(family.name), own: true }))
        fontButtons = [...builtIn, ...own].map(({ name, choice, own: mine }) => {
            const button = element('button', { type: 'button', class: mine ? 'font own' : 'font', 'aria-pressed': 'false', 'data-font': choice }, mine ? icon(ICONS.upload) : '')
            button.append(name)
            button.style.fontFamily = fontStack(choice)
            button.addEventListener('click', () => choose({ font: choice }))
            return button
        })
        fonts.row.replaceChildren(...fontButtons, addFont)
    }
    fillFontButtons()
    const smaller = element('button', { type: 'button', class: 'step', 'aria-label': 'Less size' }, '<span class="small-a">A</span>')
    const larger = element('button', { type: 'button', class: 'step', 'aria-label': 'More size' }, '<span class="large-a">A</span>')
    const size = stepper('size', 'Size', smaller, larger)
    smaller.addEventListener('click', () => choose({ size: stepSize(settings.size, -1) }))
    larger.addEventListener('click', () => choose({ size: stepSize(settings.size, 1) }))
    const steppers = element('div', { class: 'steppers' })
    steppers.append(size.row)
    const spacings = SPACINGS.map(([setting, name, range, read]) => {
        const down = stepButton(`Less ${name.toLowerCase()}`, ICONS.down)
        const up = stepButton(`More ${name.toLowerCase()}`, ICONS.up)
        const { row, value } = stepper(setting, name, down, up)
        down.addEventListener('click', () => choose({ [setting]: stepIn(range, settings[setting], -1) }))
        up.addEventListener('click', () => choose({ [setting]: stepIn(range, settings[setting], 1) }))
        steppers.append(row)
        return { setting, range, read, down, value, up }
    })

    // Margins, in px: the screen's defaults until one is changed.
    const margins = element('div', { role: 'group', 'aria-label': 'Margins in pixels', class: 'margins' }, '<span class="group-label">Margins (px)</span>')
    const marginGrid = element('div', { class: 'margin-grid' })
    margins.append(marginGrid)
    const marginSteppers = SIDES.map(side => {
        const name = side[0].toUpperCase() + side.slice(1)
        const down = stepButton(`Less ${side} margin`, ICONS.down)
        const up = stepButton(`More ${side} margin`, ICONS.up)
        const { row, value } = stepper(`margin-${side}`, name, down, up, 'margin')
        const move = (step: -1 | 1): void => {
            const shown = marginsFor(settings, options.wide())
            choose({ margins: { ...shown, [side]: stepIn(MARGIN, shown[side], step) } })
        }
        down.addEventListener('click', () => move(-1))
        up.addEventListener('click', () => move(1))
        marginGrid.append(row)
        return { side, down, value, up }
    })

    const checks = element('div', { class: 'checks' })
    const checkboxes = CHECKS.map(([setting, name]) => {
        const label = element('label', {}, '<input type="checkbox"><span></span>')
        label.querySelector('span')!.textContent = name
        const box = label.querySelector('input')!
        box.addEventListener('change', () => choose({ [setting]: box.checked }))
        checks.append(label)
        return { setting, box }
    })

    // Reset to defaults asks first, in a dialog over everything.
    const resetButton = element('button', { type: 'button', class: 'reset' }, `${icon(ICONS.reset)}<span>Reset to defaults</span>`)
    const resetDialog = element('div', { id: 'reset-dialog', 'data-controls': '' })
    const dialog = element('div', { role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'reset-title', 'aria-describedby': 'reset-body' },
        '<h2 id="reset-title">Reset layout to the defaults?</h2><p id="reset-body"></p><div class="dialog-buttons"></div>')
    const cancel = element('button', { type: 'button', class: 'cancel' }, 'Cancel')
    const confirm = element('button', { type: 'button', class: 'confirm' }, 'Reset')
    dialog.querySelector('.dialog-buttons')!.append(cancel, confirm)
    resetDialog.append(dialog)
    resetDialog.hidden = true
    const closeReset = (): void => {
        resetDialog.hidden = true
        resetButton.focus()
    }
    resetButton.addEventListener('click', () => {
        dialog.querySelector('p')!.textContent = `Size, spacing, margins and page turn on this ${options.wide() ? 'computer' : 'phone'} go back to the defaults. Your theme and font stay as they are.`
        resetDialog.hidden = false
        cancel.focus()
    })
    cancel.addEventListener('click', closeReset)
    resetDialog.addEventListener('click', event => {
        if (event.target === resetDialog) closeReset()
    })
    confirm.addEventListener('click', () => {
        choose(resetLayout(settings))
        closeReset()
    })

    // Page turn: how pages turn.
    const pageTurns = group('Page turn')
    const pageTurnButtons = PAGE_TURN_CHOICES.map(([setting, name, path]) => {
        const button = element('button', { type: 'button', class: 'page-turn', 'aria-pressed': 'false' }, `${icon(ICONS[path])}<span></span>`)
        button.querySelector('span')!.textContent = name
        button.disabled = options.fixedLayout
        button.addEventListener('click', () => choose({ pageTurn: setting }))
        pageTurns.row.append(button)
        return { setting, button }
    })

    // Progress: the percent read, or page / total.
    const progressRow = element('div', { class: 'progress-row' }, '<span class="stepper-name">Progress</span>')
    const progressGroup = element('div', { role: 'radiogroup', 'aria-label': 'Progress', class: 'segments' })
    progressRow.append(progressGroup)
    const progressButtons = PROGRESS_CHOICES.map(([setting, name]) => {
        const button = element('button', { type: 'button', role: 'radio', 'aria-checked': 'false' })
        button.textContent = name
        button.addEventListener('click', () => choose({ progress: setting }))
        progressGroup.append(button)
        return { setting, button }
    })

    // Highlighters: each in its order, to move, edit and (the reader's own) delete, then Add a highlighter.
    const highlighterGroup = element('div', { role: 'group', 'aria-label': 'Highlighters', class: 'highlighter-list' },
        '<span class="group-label"><span>Highlighters</span><span class="count"></span></span><ul></ul>')
    const highlighterRows = highlighterGroup.querySelector('ul')!
    const addHighlighter = element('button', { type: 'button', class: 'add-highlighter' }, `${icon(ICONS.plus)}<span>Add a highlighter</span>`)
    highlighterGroup.append(addHighlighter)
    const deleteDialog = element('div', { id: 'highlighter-dialog', class: 'dialog-layer', 'data-controls': '' })
    const deleteBox = element('div', { role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'highlighter-dialog-title', 'aria-describedby': 'highlighter-dialog-body' },
        '<h2 id="highlighter-dialog-title"></h2><p id="highlighter-dialog-body"></p><div class="dialog-buttons"></div>')
    const keepHighlighter = element('button', { type: 'button', class: 'cancel' }, 'Cancel')
    const deleteHighlighter = element('button', { type: 'button', class: 'confirm danger' }, 'Delete')
    deleteBox.querySelector('.dialog-buttons')!.append(keepHighlighter, deleteHighlighter)
    deleteDialog.append(deleteBox)
    deleteDialog.hidden = true
    let deleting: string | null = null
    const closeDelete = (): void => {
        deleteDialog.hidden = true
        deleting = null
    }
    keepHighlighter.addEventListener('click', closeDelete)
    deleteDialog.addEventListener('click', event => {
        if (event.target === deleteDialog) closeDelete()
    })
    deleteHighlighter.addEventListener('click', () => {
        const highlighters = options.highlighters
        const id = deleting
        closeDelete()
        if (!highlighters || !id) return
        const left = highlighters.list().filter(highlighter => highlighter.id !== id).map(({ id: kept, name, solid }) => ({ id: kept, name, colour: solid }))
        // Its highlights become Quotes highlights on the server; read this book's again.
        void highlighters.save(left).then(saved => { if (saved) void options.highlights?.reload() })
    })
    const confirmDelete = async (id: string): Promise<void> => {
        const highlighters = options.highlighters
        if (!highlighters) return
        await highlighters.refresh()
        const { name, uses } = highlighters.find(id)
        deleteBox.querySelector('h2')!.textContent = `Delete the ${name} highlighter?`
        deleteBox.querySelector('p')!.textContent = uses === 0 ? 'No highlights use it.'
            : uses === 1 ? '1 highlight uses it. It will become a Quotes highlight, so nothing you marked is lost.'
                : `${uses} highlights use it. They will become Quotes highlights, so nothing you marked is lost.`
        deleting = id
        deleteDialog.hidden = false
        keepHighlighter.focus()
    }
    // Keeps the list in a new order, then puts the focus back on the moved one's handle.
    const reorder = (from: number, to: number): void => {
        const highlighters = options.highlighters
        if (!highlighters || from === to) return
        const list = highlighters.list()
        const id = list[from].id
        void highlighters.save(moved(list, from, to).map(({ id: kept, name, solid }) => ({ id: kept, name, colour: solid }))).then(() => {
            highlighterRows.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"] .move`)?.focus()
        })
    }
    const fillHighlighterList = (): void => {
        const highlighters = options.highlighters
        if (!highlighters) return
        const list = highlighters.list()
        highlighterGroup.querySelector('.count')!.textContent = `${list.length} of ${MAX_HIGHLIGHTERS}`
        addHighlighter.hidden = list.length >= MAX_HIGHLIGHTERS
        highlighterRows.replaceChildren(...list.map((highlighter, index) => {
            const row = element('li', { 'data-id': highlighter.id },
                `<button type="button" class="move">${icon(ICONS.drag)}</button><span class="dot"></span><span class="name"><span></span></span>`)
            const move = row.querySelector<HTMLButtonElement>('.move')!
            move.setAttribute('aria-label', `Move ${highlighter.name}`)
            row.querySelector<HTMLElement>('.dot')!.style.background = highlighter.solid
            row.querySelector('.name span')!.textContent = highlighter.name
            if (highlighter.builtIn) row.querySelector('.name')!.append(element('span', { class: 'default' }, 'Default colour'))
            const edit = element('button', { type: 'button', class: 'icon-button', 'aria-label': `Edit ${highlighter.name}` }, icon(ICONS.edit))
            edit.addEventListener('click', () => options.highlighterSheet?.open(highlighter))
            row.append(edit)
            if (!highlighter.builtIn) {
                const remove = element('button', { type: 'button', class: 'icon-button', 'aria-label': `Delete ${highlighter.name}` }, icon(ICONS.trash))
                remove.addEventListener('click', () => { void confirmDelete(highlighter.id) })
                row.append(remove)
            } else {
                row.append(element('span', { class: 'spacer', 'aria-hidden': 'true' }))
            }
            // The arrows move it one place; a drag by the handle moves it where it is dropped.
            move.addEventListener('keydown', event => {
                const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : -1
                if (to < 0 || to >= list.length) return
                event.preventDefault()
                reorder(index, to)
            })
            move.addEventListener('pointerdown', event => {
                event.preventDefault()
                move.setPointerCapture(event.pointerId)
                // The rows stay where they are while the one dragged follows the
                // pointer (moving it in the list would lose the pointer); where it
                // lands is worked out from the others' middles as the drag began.
                const middles = ([...highlighterRows.children] as HTMLElement[]).filter(each => each !== row)
                    .map(each => each.getBoundingClientRect().top + each.offsetHeight / 2)
                const startY = event.clientY
                let at = index
                row.classList.add('dragging')
                const follow = (moving: PointerEvent): void => {
                    row.style.transform = `translateY(${moving.clientY - startY}px)`
                    at = middles.filter(middle => moving.clientY > middle).length
                }
                const drop = (): void => {
                    move.removeEventListener('pointermove', follow)
                    move.removeEventListener('pointerup', drop)
                    move.removeEventListener('pointercancel', drop)
                    row.classList.remove('dragging')
                    row.style.transform = ''
                    reorder(index, at)
                }
                move.addEventListener('pointermove', follow)
                move.addEventListener('pointerup', drop)
                move.addEventListener('pointercancel', drop)
            })
            return row
        }))
    }
    addHighlighter.addEventListener('click', () => options.highlighterSheet?.open(null))
    options.highlighters?.onChange(() => {
        fillHighlighterList()
        if (state.contents && tabShown === 'highlights') fillHighlights()
    })
    fillHighlighterList()

    // Your fonts: add a file, and each family with its styles and Remove.
    const fontFile = fontsBody.querySelector<HTMLInputElement>('input[type="file"]')!
    const fontMessage = fontsBody.querySelector<HTMLElement>('.message')!
    const ownList = fontsBody.querySelector('.own-fonts ul')!
    const fillOwnFonts = (): void => {
        const families = options.fonts.families()
        fontsBody.querySelector<HTMLElement>('.own-fonts')!.hidden = !families.length
        ownList.replaceChildren(...families.map(family => {
            const row = element('li', {}, '<span class="names"><span class="family"></span><span class="styles"></span></span>')
            const name = row.querySelector<HTMLElement>('.family')!
            name.textContent = family.name
            name.style.fontFamily = fontStack(ownFont(family.name))
            row.querySelector('.styles')!.textContent = stylesOf(family)
            const remove = element('button', { type: 'button', class: 'icon-button', 'aria-label': `Remove ${family.name}` }, icon(ICONS.trash))
            remove.addEventListener('click', async () => {
                fontMessage.textContent = ''
                if (!await options.fonts.remove(family.name)) {
                    fontMessage.textContent = `${family.name} could not be removed. Try again.`
                    return
                }
                if (ownFamilyOf(settings.font) === family.name) choose({ font: 'Default' })
            })
            row.append(remove)
            return row
        }))
    }
    // New theme and Edit theme, and the dialog Delete theme asks in.
    const themeSheet = createThemeSheet({
        themes: options.themes,
        title: options.title,
        inUse: () => ownThemeOf(settings.theme),
        saved: (id, added) => {
            if (added) choose({ theme: ownTheme(id) })
        },
        deletedInUse: () => choose({ theme: 'light' }),
        done: () => backToPrefs(),
    })
    prefs.append(themeSheet.body)
    const openTheme = (editing: OwnTheme | null): void => {
        const start = startingColours(editing ?? themeShown(settings.theme, options.themes.list()))
        showSheet('theme', themeSheet.open(editing, start))
        prefsBack.focus()
    }
    addTheme.addEventListener('click', () => openTheme(null))
    options.themes.onChange(() => {
        fillThemeButtons()
        fillPrefs()
    })

    // Which of Preferences, Your fonts and the theme sheet shows.
    const showSheet = (sheet: 'fonts' | 'theme' | null, title = 'Preferences'): void => {
        prefsBody.hidden = sheet !== null
        fontsBody.hidden = sheet !== 'fonts'
        themeSheet.body.hidden = sheet !== 'theme'
        prefsBack.hidden = sheet === null
        prefsTitle.textContent = title
        prefs.setAttribute('aria-label', title)
        if (sheet) prefs.dataset.sheet = sheet
        else delete prefs.dataset.sheet
        if (sheet !== 'fonts') fontMessage.textContent = ''
    }
    // Back to Preferences, focusing what opened the sheet.
    const backToPrefs = (): void => {
        const from = prefs.dataset.sheet
        showSheet(null)
        if (from === 'fonts') addFont.focus()
        else (themeButtons.find(button => button.dataset.theme === settings.theme) ?? addTheme).focus()
    }
    addFont.addEventListener('click', () => {
        showSheet('fonts', 'Your fonts')
        prefsBack.focus()
    })
    prefsBack.addEventListener('click', backToPrefs)
    fontFile.addEventListener('change', async () => {
        const [file] = fontFile.files ?? []
        fontFile.value = ''
        if (!file) return
        fontMessage.textContent = `Adding ${file.name}…`
        fontMessage.textContent = await options.fonts.add(file) ?? ''
    })
    options.fonts.onChange(() => {
        fillFontButtons()
        fillOwnFonts()
        fillPrefs()
    })
    fillOwnFonts()

    prefsBody.append(themes.box, fonts.box, steppers, margins, pageTurns.box, progressRow, checks)
    if (options.highlighters) prefsBody.append(highlighterGroup)
    prefsBody.append(resetButton)
    const fillPrefs = (): void => {
        const fixed = options.fixedLayout
        const own = settings.bookLayout
        for (const button of themeButtons) button.setAttribute('aria-pressed', String(button.dataset.theme === settings.theme))
        for (const button of fontButtons) {
            button.setAttribute('aria-pressed', String(button.dataset.font === settings.font))
            button.disabled = fixed || own
        }
        size.value.textContent = String(settings.size)
        smaller.disabled = fixed || settings.size <= SIZE.min
        larger.disabled = fixed || settings.size >= SIZE.max
        for (const { setting, range, read, down, value, up } of spacings) {
            value.textContent = read(settings[setting])
            down.disabled = fixed || own || settings[setting] <= range.min
            up.disabled = fixed || own || settings[setting] >= range.max
        }
        const shown = marginsFor(settings, options.wide())
        for (const { side, down, value, up } of marginSteppers) {
            value.textContent = String(shown[side])
            down.disabled = fixed || shown[side] <= MARGIN.min
            up.disabled = fixed || shown[side] >= MARGIN.max
        }
        for (const { setting, button } of pageTurnButtons) button.setAttribute('aria-pressed', String(settings.pageTurn === setting))
        for (const { setting, button } of progressButtons) button.setAttribute('aria-checked', String(settings.progress === setting))
        for (const { setting, box } of checkboxes) {
            box.checked = settings[setting]
            box.disabled = fixed || (own && setting !== 'bookLayout')
        }
    }
    const choose = (changed: Partial<Settings>): void => {
        // The first choice of Scroll shows its gestures, once.
        const scrolling = changed.pageTurn === 'scroll' && settings.pageTurn !== 'scroll'
        settings = { ...settings, ...changed }
        if (scrolling && hintDue(readHintsSeen(options.storage), 'scroll')) hint.show('scroll')
        options.change(settings)
        fillPrefs()
    }
    fillPrefs()

    root.append(reading.row, bar, backdrop, more, contentsBackdrop, contents, prefsBackdrop, prefs, searchBackdrop, searchPanel, resetDialog, deleteDialog, themeSheet.dialog)

    // The reading gestures hint, over everything: by itself the first time
    // this device opens a book, and from More at any time.
    const hint = createHint(root, options.touch, kind => sawHint(options.storage, kind))
    const showHint = (): void => hint.show(hintKind(settings.pageTurn, options.touch()))
    showGestures.addEventListener('click', () => {
        apply('outside')
        showHint()
    })

    let state: ControlsState = HIDDEN
    let panelOpen = false
    // The arrows read as the page turns, and hide at the book's ends and while a panel is open.
    const showArrows = (): void => {
        const scrolling = !options.fixedLayout && settings.pageTurn === 'scroll'
        previous.setAttribute('aria-label', scrolling ? 'Scroll up' : 'Previous page')
        next.setAttribute('aria-label', scrolling ? 'Scroll down' : 'Next page')
        const { start, end } = options.edges()
        previous.hidden = panelOpen || start
        next.hidden = panelOpen || end
    }
    const show = (): void => {
        const panel = state.contents || state.prefs || state.search
        if (panel !== panelOpen) {
            panelOpen = panel
            options.panel(panel)
        }
        showArrows()
        bar.hidden = !state.shown
        reading.row.hidden = state.shown
        more.hidden = !state.more
        backdrop.hidden = !state.more
        moreButton.setAttribute('aria-expanded', String(state.more))
        contents.hidden = !state.contents
        contentsBackdrop.hidden = !state.contents
        contentsButton.setAttribute('aria-expanded', String(state.contents))
        prefs.hidden = !state.prefs
        prefsBackdrop.hidden = !state.prefs
        prefsButton.setAttribute('aria-expanded', String(state.prefs))
        searchPanel.hidden = !state.search
        searchBackdrop.hidden = !state.search
    }
    const apply = (event: ControlsEvent): void => {
        const opening = event === 'contents' && !state.contents
        const openingPrefs = event === 'prefs' && !state.prefs
        const openingSearch = event === 'search' && !state.search
        state = nextControls(state, event)
        show()
        if (opening) {
            // Fill on opening, so the entry being read is the one marked, and show it.
            chooseTab(tabShown)
            close.focus()
        }
        if (openingPrefs) {
            showSheet(null)
            prefsClose.focus()
        }
        if (openingSearch) searchField.focus()
    }
    show()
    if (hintDue(readHintsSeen(options.storage), 'open')) showHint()

    moreButton.addEventListener('click', () => apply('more'))
    backdrop.addEventListener('click', () => apply('outside'))
    contentsButton.addEventListener('click', () => apply('contents'))
    contentsBackdrop.addEventListener('click', () => apply('outside'))
    close.addEventListener('click', () => apply('outside'))
    prefsButton.addEventListener('click', () => apply('prefs'))
    prefsBackdrop.addEventListener('click', () => apply('outside'))
    prefsClose.addEventListener('click', () => apply('outside'))
    searchItem.addEventListener('click', () => apply('search'))
    searchBackdrop.addEventListener('click', () => apply('outside'))
    searchClose.addEventListener('click', () => apply('outside'))
    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return
        if (hint.shown) hint.close()
        else if (!resetDialog.hidden) closeReset()
        else if (!deleteDialog.hidden) closeDelete()
        else if (themeSheet.closeDialog()) return
        else if (state.more || state.contents || state.prefs || state.search) {
            // Escape in the search field would also clear it; the search stays for next time.
            event.preventDefault()
            apply('outside')
        }
    })

    // The bookmark beside the progress, in both footers, shows whether the page is bookmarked.
    const showBookmark = (): void => {
        const marked = options.bookmarks.marked()
        for (const { bookmark } of [reading, place]) {
            bookmark.setAttribute('aria-pressed', String(marked))
            bookmark.setAttribute('aria-label', marked ? 'Remove the bookmark on this page' : 'Bookmark this page')
            bookmark.innerHTML = icon(marked ? ICONS.bookmarkOn : ICONS.bookmarkOff)
        }
    }
    for (const { bookmark } of [reading, place]) bookmark.addEventListener('click', () => { void options.bookmarks.toggle() })
    options.bookmarks.onChange(() => {
        showBookmark()
        if (state.contents && tabShown === 'bookmarks') fillBookmarks()
    })
    options.highlights?.onChange(() => {
        if (state.contents && tabShown === 'highlights') fillHighlights()
    })

    // The percent follows the slider while it moves; the book moves on release.
    slider.addEventListener('input', () => { place.progress.textContent = percent(Number(slider.value) / 100) })
    slider.addEventListener('change', () => { void options.seek(Number(slider.value) / 100) })

    return {
        middle: () => apply('middle'),
        search(query) {
            if (!options.search) return
            if (!state.search) apply('find')
            searchField.value = query
            void runSearch(query)
        },
        turned: () => apply('turned'),
        locate(chapter, fraction, progress, left) {
            for (const row of [reading, place]) {
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
            showBookmark()
            showArrows()
        },
        refill() {
            if (state.contents) fills[tabShown]()
        },
    }
}
