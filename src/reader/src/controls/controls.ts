import type { Settings } from '../settings/settings'
import { createBar } from './bar'
import type { Bookmarks } from './bookmarks'
import type { ContentsRow } from './contents'
import { createContentsPanel } from './contents-panel'
import { closeOnEscape } from './escape'
import type { OwnFonts } from './fonts'
import type { HighlighterSheet } from './highlighter-sheet'
import type { Highlighters } from './highlighters'
import type { Highlights } from './highlights'
import { createHint, hintDue, hintKind, readHintsSeen, sawHint } from './hint'
import { createMore } from './more'
import { createPanels } from './panels'
import { createPreferences } from './preferences'
import type { ProgressShown } from './progress'
import type { BookSearch } from './search'
import { createSearchPanel } from './search-panel'
import type { OwnThemes } from './themes'

/** What the controls show and where their links go. */
export interface ControlsOptions {
    /** The book's title, for the header. */
    title: string
    /** The book's details page in jellyfin-web. */
    detailsUrl: string
    /** Your reading data for this book. */
    dataUrl: string
    /** Oriel's license and the third-party notices. */
    licensesUrl: string
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
    /** Whether the server lets readers add fonts; without it there is no Add font and no Your fonts. */
    fontUploads: boolean
    /** The reader's own themes, kept on the server. */
    themes: OwnThemes
    /** The settings the reader opened with. */
    settings: Settings
    /** True for comics and PDFs, whose pages have no text to restyle. */
    fixedLayout: boolean
    /** True on a screen wider than a phone's, whose margins start wider. */
    wide(): boolean
    /** True when the reader reads by touch, whose reading gestures are taps and swipes: the last input, else the primary pointer. */
    touch: () => boolean
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

/**
 * Adds the reader's controls to `root`: a reading footer shown while reading,
 * and the header, footer and More shown by a tap in the middle of the page.
 */
export const createControls = (root: HTMLElement, options: ControlsOptions): Controls => {
    const chosen = (): void => panels.apply('chosen')
    const bar = createBar({
        title: options.title,
        detailsUrl: options.detailsUrl,
        bookmarks: options.bookmarks,
        seek: fraction => options.seek(fraction),
        turnPage: direction => options.turnPage(direction),
        edges: () => options.edges(),
        scrolling: () => !options.fixedLayout && preferences.settings().pageTurn === 'scroll',
    })
    const more = createMore({ ...options, search: options.search !== null })
    const contents = createContentsPanel({ ...options, chosen })
    const search = createSearchPanel(options.search, chosen)
    const preferences = createPreferences({
        ...options,
        change(settings, before) {
            // The first choice of Scroll shows its gestures, once.
            const scrolling = settings.pageTurn === 'scroll' && before.pageTurn !== 'scroll'
            if (scrolling && hintDue(readHintsSeen(options.storage), 'scroll')) hint.show('scroll')
            options.change(settings)
        },
    })
    const { reset, highlighterDelete, themeSheet } = preferences
    root.append(bar.reading, bar.bar, more.backdrop, more.menu, contents.backdrop, contents.panel, preferences.backdrop, preferences.panel,
        search.backdrop, search.panel, reset.dialog, highlighterDelete.dialog, themeSheet.dialog)

    // The reading gestures hint, over everything: by itself the first time
    // this device opens a book, and from More at any time.
    const hint = createHint(root, options.touch, kind => sawHint(options.storage, kind))
    const showHint = (): void => hint.show(hintKind(preferences.settings().pageTurn, options.touch()))
    const panels = createPanels({ bar, more, contents, preferences, search, panel: open => options.panel(open) })
    const refill = (tab?: 'bookmarks' | 'highlights'): void => {
        if (panels.state().contents) contents.refill(tab)
    }
    more.showGestures.addEventListener('click', () => {
        panels.apply('outside')
        showHint()
    })
    if (hintDue(readHintsSeen(options.storage), 'open')) showHint()

    document.addEventListener('keydown', closeOnEscape({
        hint,
        reset,
        highlighter: highlighterDelete,
        theme: () => themeSheet.closeDialog(),
        panels: {
            get shown() {
                const { more, contents, prefs, search } = panels.state()
                return more || contents || prefs || search
            },
            close: () => panels.apply('outside'),
        },
    }))

    options.highlighters?.onChange(() => {
        preferences.fillHighlighters()
        refill('highlights')
    })
    options.bookmarks.onChange(() => {
        bar.showBookmark()
        refill('bookmarks')
    })
    options.highlights?.onChange(() => refill('highlights'))

    return {
        middle: () => panels.apply('middle'),
        search(query) {
            if (!options.search) return
            if (!panels.state().search) panels.apply('find')
            search.search(query)
        },
        turned: () => panels.apply('turned'),
        locate(chapter, fraction, progress, left) {
            bar.locate(chapter, fraction, progress, left)
            bar.showBookmark()
            panels.showArrows()
        },
        refill: () => refill(),
    }
}
