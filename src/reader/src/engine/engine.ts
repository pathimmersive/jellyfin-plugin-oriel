// The only module that touches foliate-js.
import * as CFI from '../../vendor/foliate-js/epubcfi.js'
import { Overlayer } from '../../vendor/foliate-js/overlayer.js'
import { SectionProgress } from '../../vendor/foliate-js/progress.js'
import '../../vendor/foliate-js/view.js'
import type { PageMark } from '../controls/bookmarks'
import type { TocEntry } from '../controls/contents'
import type { Box, TextSelection } from '../controls/toolbar'
import type { SearchSection } from '../controls/search'
import type { PageCount, PagesShown } from '../controls/progress'
import type { Moved, StartAt } from '../position/position'
import type { Margins, PageTurn } from '../settings/settings'
import { attachPageInput, type Turn, wheelGesture } from './input'
import { columnLayout, countPages } from './pages'
import { guardSelectionDrag } from './selection'

interface FoliateView extends HTMLElement {
    open(book: Blob): Promise<void>
    init(options: { lastLocation?: unknown, showTextStart?: boolean }): Promise<void>
    goTo(target: string): Promise<unknown>
    goToFraction(fraction: number): Promise<void>
    goToTextStart(): Promise<void>
    resolveNavigation(target: string): { index?: unknown, anchor?: (doc: Document) => Element | Range | null } | undefined
    book: { dir?: string, sections: { load(): Promise<string>, unload?(): void, createDocument?(): Promise<Document>, linear?: string }[], metadata?: { title?: unknown }, toc?: TocEntry[] }
    search(options: { query: string, draw?: unknown, drawOptions?: unknown }): AsyncGenerator<FoundSection | { progress: number } | 'done'>
    getProgressOf(index: number, range?: Range): { tocItem?: { label?: string } } | undefined
    getCFI(index: number, range: Range): string
    addAnnotation(annotation: { value: string }): Promise<unknown>
    deleteAnnotation(annotation: { value: string }): Promise<unknown>
    clearSearch(): void
    next(): Promise<void>
    prev(): Promise<void>
    goLeft(): Promise<void>
    goRight(): Promise<void>
    renderer: HTMLElement & {
        setStyles?(styles: string): void
        render?(): void
        getContents?(): { doc: Document, index: number, overlayer?: { hitTest(point: { x: number, y: number }): [string?, Range?] } }[]
        readonly page?: number
        readonly size?: number
        readonly start?: number
        readonly end?: number
        readonly viewSize?: number
        readonly atStart?: boolean
        readonly atEnd?: boolean
    }
    isFixedLayout: boolean
    lastLocation?: Location
}

// A section's matches, as foliate-js's search gives them.
interface FoundSection {
    label: string
    subitems: { cfi: string, excerpt: { pre: string, match: string, post: string } }[]
}

// What foliate-js reports for the place shown.
interface Location {
    fraction?: number
    section?: { current: number, total: number }
    cfi?: string
    range?: Range
    tocItem?: { label?: string, href?: string }
}

/**
 * The place shown: its chapter's name (empty for none), the link of its
 * contents entry (null for none), the fraction of the book, and where it is
 * in pages (null for comics and PDFs, which have no columns of text).
 */
export interface Place {
    chapter: string
    href: string | null
    fraction: number
    pages: PagesShown | null
}

export interface OpenBook {
    /**
     * The CFI the book opened at, once it settled there. The paginator can
     * report reaching it a moment later as a 'navigation' move, so a save of
     * this same position is not a move by the reader.
     */
    openedAt: string | null
    /**
     * False when the book was asked to open at a CFI that is not a place in
     * it; it then shows the start of the text until `reopen` places it.
     */
    placed: boolean
    /**
     * Places the book at a fraction of it, or at the start of the text for
     * null, before any move: a re-placement, not a move, so `openedAt` is
     * updated and nothing is saved.
     */
    reopen(fraction: number | null): Promise<void>
    /**
     * Calls `onMoved` with the position now shown (its CFI and the fraction of
     * the book) whenever the reader moves: a page turn, a swipe or a link.
     * Re-placing the same position (on opening or on a resize), selecting
     * text, and snapping back to the place already shown (as the paginator
     * does after a tap) are not moves.
     */
    onMoved(onMoved: (position: Moved) => void): void
    /** The book's title, or the file's name without its extension. */
    title: string
    /** The place shown now. */
    place(): Place
    /** Calls `onPlace` with the place shown whenever it changes, moves or not. */
    onPlace(onPlace: (place: Place) => void): void
    /** Goes to a fraction of the book: a reader move, saved like a page turn. */
    seek(fraction: number): Promise<void>
    /** The book's contents, as foliate-js gives them; empty for none. */
    contents: TocEntry[]
    /** The fraction of the book where a contents link leads: the start of its section. */
    fractionOf(href: string): number | null
    /** Goes to a contents link: a reader move, saved like a page turn. */
    goTo(href: string): Promise<void>
    /** True for a fixed layout (comics, PDFs), whose pages have no text to restyle. */
    fixedLayout: boolean
    /** True for a book with text to search; comics and PDFs have none. */
    searchable: boolean
    /**
     * Searches the book's text for `query`, ignoring case and accents and
     * matching inside words: each section's matches as it is searched, with
     * the name of the contents entry it starts in. The matches are marked on
     * the page until `clearSearch` or the next search; stopping early stops
     * the search.
     */
    search(query: string): AsyncIterable<SearchSection>
    /** Clears the marks the last search left on the page. */
    clearSearch(): void
    /**
     * The page shown, as a bookmark keeps it: the CFI it starts at, the
     * fraction of the book, and the text it opens with ('Page N' in a comic
     * or PDF); null before a page is shown.
     */
    page(): PageMark | null
    /** Whether a place (a CFI) is on the page shown, from its first character to its last. */
    onPage(cfi: string): boolean
    /** The name of the contents entry a place's section starts in; empty for none. */
    chapterOf(cfi: string): string
    /** Book order of two places (CFIs): negative when `a` comes first. */
    compare(a: string, b: string): number
    /**
     * Draws highlights behind their text, each in its highlighter's colour at
     * its strength, the one at `ringed` ringed in the accent colour; highlights
     * no longer listed are cleared. Sections loaded later draw theirs as they load.
     */
    showHighlights(highlights: { cfi: string, colour: string, solid: string, fill: number }[], ringed: string | null): void
    /** Calls `selected` with the text selected in the book, or null when none is, once a selection settles (on release of the mouse). */
    onSelect(selected: (selection: TextSelection | null) => void): void
    /**
     * Calls `tapped` for a click or tap that would turn the page or show the
     * controls, with the highlight under it (its CFI) or null; true stops it there.
     */
    onTap(tapped: (cfi: string | null) => boolean): void
    /** A highlight's box on screen, or null when it is not on a page loaded. */
    boxOf(cfi: string): Box | null
    /** Clears any text selected in the book. */
    clearSelection(): void
    /**
     * Puts a stylesheet in every section of a reflowable book, now and as
     * sections load; the page lays out again around the place being read.
     */
    setStyles(styles: string): void
    /**
     * Sets the space between the reading area's edges and a reflowable
     * book's text; the page lays out again around the place being read.
     */
    setMargins(margins: Margins): void
    /**
     * Keeps a reflowable book clear of a panel this many px wide at the
     * right (0 for none): the text ends 20 px from it, in one column where
     * the space left is too narrow for two.
     */
    setPanel(width: number): void
    /** Lays a reflowable book out in one column however wide the reading area, as on a phone in landscape. */
    setOneColumn(on: boolean): void
    /** Turns a page back or forward in the chosen page turn, as the controls' arrows do, leaving the controls as they are. */
    turnPage(direction: 'prev' | 'next'): void
    /** Whether the place shown is the book's first page, and its last. */
    edges(): { start: boolean, end: boolean }
    /** Sets how pages turn, keeping the place being read; comics and PDFs keep their own. */
    setPageTurn(pageTurn: PageTurn): void
    /**
     * The layout pages are counted for: the stylesheet, the page size and the
     * gap. A count made for one layout holds for another with the same text.
     */
    layout(): string
    /**
     * Counts the pages of a reflowable book in its current layout, in the
     * background, giving each contents link and each of `places` (CFIs) the
     * page it starts on; null for a fixed layout, or when `cancelled` turns true first.
     */
    count(cancelled: () => boolean, places?: string[]): Promise<PageCount | null>
    /**
     * Where a place (a CFI) is in the section shown, laid out as on screen:
     * the section and its page there (from 0); null when another section is shown.
     */
    pageShown(cfi: string): { section: number, page: number } | null
}

// foliate-js's widest column: a text area wider than this, in landscape, shows two.
const COLUMN_WIDTH = 720
// The paginator's gap in px: the least space at the sides, and between two columns.
const ONE_COLUMN_GAP = 4
const TWO_COLUMN_GAP = 48
// The space between the text and a panel open beside it.
const PANEL_SPACE = 20

// The colour search marks matches on the page in: the selection colour, at foliate-js's highlight opacity.
const SEARCH_MARK = '#00a4dc'

// How a highlight is drawn: its highlighter's id, colour and strength.
interface HighlightStyle {
    colour: string
    solid: string
    fill: number
}

// The ring around a highlight tapped: the accent colour.
const HIGHLIGHT_RING = '#00a4dc'

// How long a selection must stay the same before the toolbar shows for it.
const SELECTION_SETTLES_MS = 250

// The paginator's reasons for re-placing the current position rather than moving.
const NOT_MOVES = new Set(['anchor', 'selection'])

/**
 * Opens a book file in a new paged foliate-js view inside `container`, at
 * `start` (an exact CFI or a fraction of the book) when given, else at the
 * start of the text. `onView` receives the view before the book opens, so a
 * listener sees the first section; the view emits `load` (a section document)
 * and `relocate`. `onMenu` is called for a tap or click in the middle of the
 * page, which shows or hides the reader's controls, and `onTurn` whenever the
 * reader turns the page: a key, a click or tap on an edge, the wheel or a swipe.
 * `styles` is the stylesheet a reflowable book's sections start with,
 * `margins` the space around its text, and `pageTurn` how its pages turn.
 */
export const openBook = async (
    container: HTMLElement,
    file: File,
    onView?: (view: EventTarget) => void,
    start: StartAt = null,
    onMenu: () => void = () => {},
    onTurn: () => void = () => {},
    styles = '',
    margins: Margins | null = null,
    pageTurn: PageTurn = 'none',
    oneColumnAtFirst = false,
): Promise<OpenBook> => {
    const view = document.createElement('foliate-view') as FoliateView
    // Keys, edge clicks and the wheel turn pages on a desktop, and a click in
    // the middle shows the controls. Events inside
    // the book land in each section's own document and do not reach this
    // page, so every section document gets the same listeners as this page,
    // sharing one wheel gesture.
    let turning = pageTurn
    const scrolling = (): boolean => turning === 'scroll' && !view.isFixedLayout
    const turn = (turn: Turn, hide = true): void => {
        if (hide) onTurn()
        const go = { next: () => view.next(), prev: () => view.prev(), left: () => view.goLeft(), right: () => view.goRight() }[turn]
        if (turning !== 'fade' || view.isFixedLayout) void go()
        else void fade(view, go)
    }
    // In Scroll mode: whether the book is at the start or the end of its section.
    const scroll = {
        active: scrolling,
        edges: () => ({
            start: (view.renderer.start ?? 0) <= 1,
            end: (view.renderer.viewSize ?? 0) - (view.renderer.end ?? 0) <= 2,
        }),
    }
    const gesture = wheelGesture()
    const page = (): DOMRect => container.getBoundingClientRect()
    // The highlights drawn, by CFI, with their highlighters' ids, colours and
    // strengths, and the one ringed. foliate-js asks for each one's drawing as
    // it is added, and again as its section loads.
    let drawn = new Map<string, HighlightStyle>()
    let ringed: string | null = null
    // A tap is first offered to highlighting, with the highlight under it.
    let tapped: (cfi: string | null) => boolean = () => false
    // The highlight drawn at a point of a section's document.
    const highlightAt = (doc: Document, x: number, y: number): string | null => {
        const [value] = view.renderer.getContents?.().find(contents => contents.doc === doc)?.overlayer?.hitTest({ x, y }) ?? []
        return value && drawn.has(value) ? value : null
    }
    attachPageInput(document, () => ({ left: page().left, width: page().width, top: page().top, height: page().height }),
        gesture, turn, onMenu, onTurn, scroll, () => tapped(null))
    // Text selected in a section, once it settles: a mouse selection on release.
    let selected: (selection: TextSelection | null) => void = () => {}
    const selectionIn = (doc: Document): TextSelection | null => {
        const selection = doc.getSelection()
        if (view.isFixedLayout || !selection || selection.isCollapsed || !selection.rangeCount) return null
        const range = selection.getRangeAt(0)
        const text = rangeText(range).replace(/\s+/g, ' ').trim()
        const index = view.renderer.getContents?.().find(contents => contents.doc === doc)?.index
        if (!text || index === undefined) return null
        return { cfi: view.getCFI(index, range), fraction: view.lastLocation?.fraction ?? 0, text, box: boxOn(doc, range.getBoundingClientRect()) }
    }
    view.addEventListener('load', event => {
        const doc = (event as CustomEvent<{ doc: Document }>).detail.doc
        guardSelectionDrag(doc)
        let pressed = false
        let settling = 0
        const settle = (): void => {
            clearTimeout(settling)
            settling = window.setTimeout(() => selected(selectionIn(doc)), SELECTION_SETTLES_MS)
        }
        doc.addEventListener('selectionchange', () => { if (!pressed) settle() })
        doc.defaultView?.addEventListener('pointerdown', event => { pressed = event.pointerType === 'mouse' && event.button === 0 })
        doc.defaultView?.addEventListener('pointerup', () => {
            if (!pressed) return
            pressed = false
            settle()
        })
        attachPageInput(doc, () => {
            // The page's left edge and width in the section frame's own
            // coordinates. Fixed-layout pages (comics) scale their frame with a
            // CSS transform, so a position inside it is unscaled.
            const element = doc.defaultView?.frameElement as HTMLElement | null | undefined
            const frame = element?.getBoundingClientRect()
            if (!element || !frame) return null
            const scale = element.offsetWidth > 0 ? frame.width / element.offsetWidth : 1
            return {
                left: (page().left - frame.left) / scale,
                width: page().width / scale,
                top: (page().top - frame.top) / scale,
                height: page().height / scale,
            }
        }, gesture, turn, onMenu, onTurn, scroll, (x, y) => tapped(highlightAt(doc, x, y)))
    })
    onView?.(view)
    container.replaceChildren(view)
    await view.open(file)
    // Slide animates a turn; Scroll lays the book out as one vertical column.
    const applyPageTurn = (): void => {
        if (view.isFixedLayout) return
        view.renderer.toggleAttribute('animated', turning === 'slide')
        const flow = turning === 'scroll' ? 'scrolled' : 'paginated'
        if (view.renderer.getAttribute('flow') !== flow) view.renderer.setAttribute('flow', flow)
    }
    applyPageTurn()
    // Before the first render, so the first page shows in the reader's settings.
    let shownStyles = styles
    const setStyles = (styles: string): void => {
        shownStyles = styles
        if (!view.isFixedLayout) view.renderer.setStyles?.(styles)
    }
    setStyles(styles)
    // Margins are padding on the container, so the paginator keeps none of
    // its own above and below. Its gap puts the same space between columns
    // and at the outer edges, which comes off the side padding. The gap is
    // never 0: a justified line reaches its column's edge, and with no gap
    // foliate-js counts it as shown on the next page too, so that page's
    // place would start on the one before.
    // A panel open at the right takes its width and 20 px off the text area.
    let shownMargins = margins
    let panel = 0
    let oneColumn = oneColumnAtFirst
    const layOut = (): void => {
        if (view.isFixedLayout || !shownMargins) return
        const { width: outerWidth, height: outerHeight } = container.getBoundingClientRect()
        if (!outerWidth) return
        const { left, top, bottom } = shownMargins
        const right = panel ? panel + PANEL_SPACE : shownMargins.right
        const twoColumns = !oneColumn && outerWidth - left - right > COLUMN_WIDTH && outerWidth - left - right > outerHeight - top - bottom
        const columns = twoColumns ? '2' : '1'
        const gap = twoColumns ? TWO_COLUMN_GAP : ONE_COLUMN_GAP
        const padLeft = Math.max(0, left - gap)
        const padRight = Math.max(0, right - gap)
        container.style.padding = `${top}px ${padRight}px ${bottom}px ${padLeft}px`
        const share = `${(gap / (outerWidth - padLeft - padRight) * 100).toFixed(4)}%`
        if (view.renderer.getAttribute('gap') === share && view.renderer.getAttribute('max-column-count') === columns) return
        view.renderer.setAttribute('gap', share)
        view.renderer.setAttribute('max-column-count', columns)
        view.renderer.render?.()
    }
    const setMargins = (margins: Margins): void => {
        shownMargins = margins
        layOut()
    }
    if (!view.isFixedLayout) view.renderer.setAttribute('margin', '0px')
    layOut()
    // The container is hidden until the first page shows, and resizes with the window.
    new ResizeObserver(layOut).observe(container)
    // The paginator can place a position only once it knows the page count,
    // which the first render works out; placed any earlier, the view stays on
    // its blank lead page. So open at the text start, then move to the saved
    // position. The move is a re-placement ('anchor'), not a move to save.
    await view.init({ showTextStart: true })
    let placed = true
    if (start && 'cfi' in start) placed = await placeCfi(view, start.cfi)
    else if (start) await view.goToFraction(start.fraction)
    // A CFI that names no section, or that the view could not go to, leaves
    // nothing sensible on screen: go back to the start of the text.
    if (!placed) await view.goToTextStart()
    // Every contents link, and what each leads to.
    const hrefs: string[] = []
    const gather = (entries: TocEntry[]): void => {
        for (const entry of entries) {
            if (entry.href) hrefs.push(entry.href)
            if (entry.subitems) gather(entry.subitems)
        }
    }
    gather(view.book.toc ?? [])
    const resolve = (href: string): { index: number, anchor?: (doc: Document) => Element | Range | null } | null => {
        try {
            const resolved = view.resolveNavigation(href)
            return typeof resolved?.index === 'number' ? { index: resolved.index, anchor: resolved.anchor } : null
        } catch {
            return null
        }
    }
    // The section shown in pages: the pages on screen and the pages left
    // before the next contents entry in the section, or else its end.
    const pagesShown = (): PagesShown | null => {
        const contents = view.isFixedLayout ? undefined : view.renderer.getContents?.()[0]
        if (!contents?.doc || !view.renderer.size) return null
        const layout = columnLayout(contents.doc, view.renderer.size, scrolling())
        // Scrolled, a page is a screen, and the screens shown run from the one
        // at the top to the one at the bottom; paged, there is a blank page
        // before the text.
        const start = view.renderer.start ?? 0
        const size = view.renderer.size
        const page = scrolling() ? Math.floor((start + 1) / size) : ((view.renderer.page ?? 1) - 1) * layout.perScreen
        const first = Math.min(layout.columns - 1, Math.max(0, page))
        const last = Math.min(layout.columns - 1, scrolling() ? Math.floor((start + size - 1) / size) : first + layout.perScreen - 1)
        let chapterLast = layout.columns - 1
        for (const href of hrefs) {
            const target = resolve(href)
            if (target?.index !== contents.index) continue
            const node = target.anchor?.(contents.doc)
            if (!node) continue
            const { column, atTop } = layout.place(node)
            // An entry starting at the top of the first page shown is the chapter being read.
            if (column < first || (column === first && atTop)) continue
            chapterLast = Math.min(chapterLast, atTop ? column - 1 : column)
        }
        return { section: contents.index, first, last, left: Math.max(0, chapterLast - last) }
    }
    const place = (): Place => ({
        chapter: view.lastLocation?.tocItem?.label?.trim() ?? '',
        href: view.lastLocation?.tocItem?.href ?? null,
        fraction: view.lastLocation?.fraction ?? 0,
        pages: pagesShown(),
    })
    const annotation = (cfi: string): { value: string } => ({ value: cfi })
    view.addEventListener('draw-annotation', event => {
        const { draw, annotation } = (event as CustomEvent<{ draw: (draw: unknown, options: unknown) => void, annotation: { value: string } }>).detail
        const style = drawn.get(annotation.value)
        if (!style) return
        draw(drawHighlight, { ...style, ring: annotation.value === ringed ? HIGHLIGHT_RING : null })
    })
    view.addEventListener('create-overlay', event => {
        const { index } = (event as CustomEvent<{ index: number }>).detail
        for (const cfi of drawn.keys()) if (resolve(cfi)?.index === index) void view.addAnnotation(annotation(cfi))
    })
    // Where each section starts, as foliate-js measures progress through the book.
    const sectionStarts: number[] = new SectionProgress(view.book.sections, 1500, 1600).sectionFractions
    const opened: OpenBook = {
        openedAt: view.lastLocation?.cfi ?? null,
        placed,
        title: bookTitle(view.book.metadata?.title) || file.name.replace(/\.[^.]+$/, ''),
        place,
        onPlace(onPlace) {
            view.addEventListener('relocate', () => onPlace(place()))
        },
        async seek(fraction) {
            await view.goToFraction(fraction)
        },
        contents: view.book.toc ?? [],
        fractionOf(href) {
            const index = view.resolveNavigation(href)?.index
            return typeof index === 'number' && Number.isInteger(index) ? sectionStarts[index] ?? null : null
        },
        async goTo(href) {
            await view.goTo(href)
        },
        fixedLayout: view.isFixedLayout,
        searchable: !view.isFixedLayout && view.book.sections.some(section => section.createDocument),
        async * search(query) {
            for await (const found of view.search({ query, draw: Overlayer.highlight, drawOptions: { color: SEARCH_MARK } })) {
                if (typeof found !== 'object' || !('subitems' in found)) continue
                yield {
                    label: found.label.trim(),
                    matches: found.subitems.map(({ cfi, excerpt }) => ({ cfi, ...excerpt })),
                }
            }
        },
        clearSearch() {
            view.clearSearch()
        },
        page() {
            const location = view.lastLocation
            if (!location?.cfi) return null
            const cfi: string = CFI.collapse(location.cfi)
            const index = resolve(cfi)?.index
            const text = view.isFixedLayout ? `Page ${(index ?? 0) + 1}` : location.range ? rangeText(location.range) : ''
            return { cfi, fraction: location.fraction ?? 0, text }
        },
        onPage(cfi) {
            const shown = view.lastLocation?.cfi
            if (!shown) return false
            // A comic's or PDF's page is a section; a spread shows two.
            if (view.isFixedLayout) {
                const index = resolve(cfi)?.index
                return (view.renderer.getContents?.() ?? []).some(contents => contents.index === index)
            }
            try {
                return CFI.compare(cfi, CFI.collapse(shown)) >= 0 && CFI.compare(cfi, CFI.collapse(shown, true)) <= 0
            } catch {
                return false
            }
        },
        chapterOf(cfi) {
            const index = resolve(cfi)?.index
            return index === undefined ? '' : view.getProgressOf(index)?.tocItem?.label?.trim() ?? ''
        },
        compare(a, b) {
            try {
                return CFI.compare(a, b)
            } catch {
                return 0
            }
        },
        showHighlights(highlights, ring) {
            if (view.isFixedLayout) return
            const next = new Map(highlights.map(({ cfi, colour, solid, fill }) => [cfi, { colour, solid, fill }]))
            const before = drawn
            const ringedBefore = ringed
            drawn = next
            ringed = ring
            for (const cfi of before.keys()) if (!next.has(cfi)) void view.deleteAnnotation(annotation(cfi))
            const same = (a?: HighlightStyle, b?: HighlightStyle): boolean => !!a && !!b && a.colour === b.colour && a.solid === b.solid && a.fill === b.fill
            for (const [cfi, style] of next) {
                if (!same(before.get(cfi), style) || cfi === ring || cfi === ringedBefore) void view.addAnnotation(annotation(cfi))
            }
        },
        onSelect(onSelected) {
            selected = onSelected
        },
        onTap(onTapped) {
            tapped = onTapped
        },
        boxOf(cfi) {
            const target = resolve(cfi)
            const doc = view.renderer.getContents?.().find(contents => contents.index === target?.index)?.doc
            const range = doc && target?.anchor?.(doc)
            return doc && range ? boxOn(doc, range.getBoundingClientRect()) : null
        },
        clearSelection() {
            for (const { doc } of view.renderer.getContents?.() ?? []) doc.getSelection()?.removeAllRanges()
        },
        setStyles,
        setMargins,
        setPanel(width) {
            if (width === panel) return
            panel = width
            layOut()
        },
        setOneColumn(on) {
            if (on === oneColumn) return
            oneColumn = on
            layOut()
        },
        turnPage(direction) {
            turn(direction, false)
        },
        edges() {
            if (!view.isFixedLayout) return { start: view.renderer.atStart ?? false, end: view.renderer.atEnd ?? false }
            const section = view.lastLocation?.section
            return section ? { start: section.current <= 0, end: section.current >= section.total - 1 } : { start: false, end: false }
        },
        setPageTurn(pageTurn) {
            turning = pageTurn
            applyPageTurn()
        },
        layout() {
            // The container may have been hidden when the margins were last set.
            layOut()
            const { width, height } = view.renderer.getBoundingClientRect()
            return `${Math.round(width)}x${Math.round(height)}|${view.renderer.getAttribute('flow') ?? ''}|${view.renderer.getAttribute('gap') ?? ''}|${view.renderer.getAttribute('max-column-count') ?? ''}|${shownStyles}`
        },
        async count(cancelled, places = []) {
            if (view.isFixedLayout) return null
            layOut()
            return countPages(view.renderer, view.book, shownStyles, [...hrefs, ...places], resolve,
                () => view.renderer.getContents?.()[0]?.index ?? -1, cancelled)
        },
        pageShown(cfi) {
            const contents = view.isFixedLayout ? undefined : view.renderer.getContents?.()[0]
            const target = resolve(cfi)
            if (!contents?.doc || !view.renderer.size || target?.index !== contents.index) return null
            const node = target.anchor?.(contents.doc)
            return node ? { section: contents.index, page: columnLayout(contents.doc, view.renderer.size, scrolling()).place(node).column } : null
        },
        async reopen(fraction) {
            if (fraction === null) await view.goToTextStart()
            else await view.goToFraction(fraction)
            opened.openedAt = view.lastLocation?.cfi ?? null
        },
        onMoved(onMoved) {
            // The view handles the renderer's relocate first and updates
            // lastLocation with the CFI and the fraction of the whole book.
            let shown = view.lastLocation?.cfi
            let shownIndex = view.renderer.getContents?.()[0]?.index
            view.renderer.addEventListener('relocate', event => {
                const { reason = '', index } = (event as CustomEvent<{ reason?: string, index?: number }>).detail ?? {}
                const move = !NOT_MOVES.has(reason)
                // Going to another section, the paginator first lays out the
                // section it has loaded, at a place left from the one before,
                // and only then goes where it was asked: that re-placement is a
                // step of the move, so it leaves the place shown as it was.
                if (!move && index !== shownIndex) return
                const { fraction, cfi } = view.lastLocation ?? {}
                const previous = shown
                shown = cfi
                shownIndex = index
                if (cfi === previous) return
                if (move && typeof fraction === 'number' && typeof cfi === 'string') onMoved({ cfi, fraction })
            })
        },
    }
    return opened
}

// How long a Fade turn takes to fade out, and again to fade back in.
const FADE_MS = 150

// Fades the book out, turns with `go`, and fades it back in.
const fade = async (view: HTMLElement, go: () => Promise<unknown>): Promise<void> => {
    view.style.transition = `opacity ${FADE_MS}ms ease`
    view.style.opacity = '0'
    await new Promise(resolve => setTimeout(resolve, FADE_MS))
    try {
        await go()
    } finally {
        view.style.opacity = '1'
    }
}

// A box in a section's document, as it is on screen in this page.
const boxOn = (doc: Document, { left, top, right, bottom }: DOMRect): Box => {
    const frame = (doc.defaultView?.frameElement as HTMLElement | null | undefined)?.getBoundingClientRect()
    const x = frame?.left ?? 0
    const y = frame?.top ?? 0
    return { left: left + x, top: top + y, right: right + x, bottom: bottom + y }
}

// Draws a highlight for foliate-js's overlayer: its lines filled with the
// highlighter's colour at its strength, behind the text, and ringed when tapped.
const drawHighlight = (rects: DOMRectList, { colour, solid, fill, ring }: { colour: string, solid: string, fill: number, ring: string | null }): SVGElement => {
    const svg = 'http://www.w3.org/2000/svg'
    const group = document.createElementNS(svg, 'g')
    group.setAttribute('data-colour', colour)
    group.setAttribute('fill', solid)
    group.setAttribute('fill-opacity', String(fill))
    if (ring) {
        group.setAttribute('data-ringed', '')
        group.setAttribute('stroke', ring)
        group.setAttribute('stroke-width', '1')
    }
    for (const { left, top, width, height } of rects) {
        const rect = document.createElementNS(svg, 'rect')
        rect.setAttribute('x', String(left))
        rect.setAttribute('y', String(top))
        rect.setAttribute('width', String(width))
        rect.setAttribute('height', String(height))
        group.append(rect)
    }
    return group
}

// The text in a range, with a space between blocks (a heading and the
// paragraph after it), which the range's own text runs together.
const rangeText = (range: Range): string => {
    const root = range.commonAncestorContainer
    const doc = root.ownerDocument ?? (root as Document)
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    // The nearest ancestor laid out as a block; text in another one starts a new block.
    const blockOf = (node: Node): Element | null => {
        let element = node.parentElement
        while (element && doc.defaultView?.getComputedStyle(element).display.startsWith('inline')) element = element.parentElement
        return element
    }
    let text = ''
    let block: Element | null = null
    for (let node = walker.currentNode.nodeType === Node.TEXT_NODE ? walker.currentNode : walker.nextNode(); node; node = walker.nextNode()) {
        if (!range.intersectsNode(node)) continue
        const value = node.nodeValue ?? ''
        const start = node === range.startContainer ? range.startOffset : 0
        const end = node === range.endContainer ? range.endOffset : value.length
        const here = blockOf(node)
        text += (text && here !== block ? ' ' : '') + value.slice(start, end)
        block = here
    }
    return text
}

// A book's title as foliate-js gives it: a string, or a map of language to string.
const bookTitle = (title: unknown): string => {
    if (typeof title === 'string') return title.trim()
    if (title && typeof title === 'object') {
        const first = Object.values(title).find(value => typeof value === 'string')
        return typeof first === 'string' ? first.trim() : ''
    }
    return ''
}

// Goes to a saved CFI; false when it is not a place in this book. foliate-js
// resolves a CFI to a section index without checking it, and its goTo returns
// nothing when it cannot go there.
const placeCfi = async (view: FoliateView, cfi: string): Promise<boolean> => {
    const index = view.resolveNavigation(cfi)?.index
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= view.book.sections.length) return false
    return (await view.goTo(cfi)) !== undefined
}
