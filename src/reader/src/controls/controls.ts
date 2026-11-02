import { FONTS, type FontName, INDENT, type PageTurn, type Progress, LINE_SPACING, MARGIN, marginsFor, PARAGRAPH_SPACING, type Range, resetLayout, type Settings, SIDES, SIZE, stepIn, stepSize, THEMES, type ThemeId } from '../settings/settings'
import type { Bookmarks } from './bookmarks'
import type { ContentsRow } from './contents'
import { type Colour, HIGHLIGHTERS, highlighter, highlightFill, type Highlights } from './highlights'
import { createHint, hintDue, hintKind, readHintsSeen, sawHint } from './hint'
import { pagesLeftName, percent, type ProgressShown } from './progress'
import { type BookSearch, noMatches } from './search'
import { type ControlsEvent, type ControlsState, HIDDEN, nextControls } from './state'

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
    search: 'M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
    note: 'M3 18h12v-2H3v2zM3 6v2h18V6H3zm0 7h18v-2H3v2z',
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
    const slider = element('input', { type: 'range', min: '0', max: '100', step: 'any', value: '0', 'aria-label': 'Position in the book' })
    const footer = element('footer')
    footer.append(place.row, slider)

    const bar = element('div', { id: 'controls', 'data-controls': '' })
    bar.append(header, footer)

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
    let colourShown: Colour | null = null
    const fillHighlights = (): void => {
        const highlights = options.highlights
        if (!highlights) return
        if (!highlights.rows(null).length) {
            highlightsBody.replaceChildren(element('div', { class: 'empty' },
                `${icon(ICONS.highlight)}<p>No highlights in this book yet.</p><p class="hint">Select text to highlight it or add a note.</p>`))
            return
        }
        const chips = element('div', { role: 'group', class: 'chips', 'aria-label': 'Show highlights of one colour' })
        for (const [colour, name, solid] of [[null, 'All', ''], ...HIGHLIGHTERS.map(each => [each.colour, each.name, each.solid] as const)] as const) {
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
            mark.style.background = highlightFill(highlighter(row.colour))
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
    const prefsHeader = element('div', { class: 'panel-header' }, '<h2>Preferences</h2>')
    prefsHeader.append(prefsClose)
    const prefsBody = element('div', { class: 'panel-body' }, '<p class="note">Your preferences apply to this device.</p>')
    prefs.append(prefsHeader, prefsBody)
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
    const themeButtons = (Object.keys(THEMES) as ThemeId[]).map(id => {
        const theme = THEMES[id]
        const button = element('button', { type: 'button', class: 'theme', 'aria-label': theme.name, 'aria-pressed': 'false', 'data-theme': id }, '<span class="swatch">Aa</span><span class="name"></span>')
        button.querySelector<HTMLElement>('.swatch')!.style.cssText = `background: ${theme.background}; color: ${theme.text}`
        button.querySelector('.name')!.textContent = theme.name
        button.addEventListener('click', () => choose({ theme: id }))
        themes.row.append(button)
        return button
    })
    const fonts = group('Font')
    const fontButtons = (Object.keys(FONTS) as FontName[]).map(name => {
        const button = element('button', { type: 'button', class: 'font', 'aria-pressed': 'false', 'data-font': name })
        button.textContent = name
        button.style.fontFamily = FONTS[name]
        button.disabled = options.fixedLayout
        button.addEventListener('click', () => choose({ font: name }))
        fonts.row.append(button)
        return button
    })
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

    prefsBody.append(themes.box, fonts.box, steppers, margins, pageTurns.box, progressRow, checks, resetButton)
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

    root.append(reading.row, bar, backdrop, more, contentsBackdrop, contents, prefsBackdrop, prefs, searchBackdrop, searchPanel, resetDialog)

    // The reading gestures hint, over everything: by itself the first time
    // this device opens a book, and from More at any time.
    const hint = createHint(root, options.touch, kind => sawHint(options.storage, kind))
    const showHint = (): void => hint.show(hintKind(settings.pageTurn, options.touch()))
    showGestures.addEventListener('click', () => {
        apply('outside')
        showHint()
    })

    let state: ControlsState = HIDDEN
    const show = (): void => {
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
        if (openingPrefs) prefsClose.focus()
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
        },
    }
}
