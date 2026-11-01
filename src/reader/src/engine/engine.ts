// The only module that touches foliate-js.
import { SectionProgress } from '../../vendor/foliate-js/progress.js'
import '../../vendor/foliate-js/view.js'
import type { TocEntry } from '../controls/contents'
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
    book: { dir?: string, sections: { load(): Promise<string>, unload?(): void, linear?: string }[], metadata?: { title?: unknown }, toc?: TocEntry[] }
    next(): Promise<void>
    prev(): Promise<void>
    goLeft(): Promise<void>
    goRight(): Promise<void>
    renderer: HTMLElement & {
        setStyles?(styles: string): void
        render?(): void
        getContents?(): { doc: Document, index: number }[]
        readonly page?: number
        readonly size?: number
        readonly start?: number
        readonly end?: number
        readonly viewSize?: number
    }
    isFixedLayout: boolean
    lastLocation?: Location
}

// What foliate-js reports for the place shown.
interface Location {
    fraction?: number
    cfi?: string
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
    /** Sets how pages turn, keeping the place being read; comics and PDFs keep their own. */
    setPageTurn(pageTurn: PageTurn): void
    /**
     * The layout pages are counted for: the stylesheet, the page size and the
     * gap. A count made for one layout holds for another with the same text.
     */
    layout(): string
    /**
     * Counts the pages of a reflowable book in its current layout, in the
     * background; null for a fixed layout, or when `cancelled` turns true first.
     */
    count(cancelled: () => boolean): Promise<PageCount | null>
}

// foliate-js's widest column: a text area wider than this, in landscape, shows two.
const COLUMN_WIDTH = 720
// The paginator's gap in px: the least space at the sides, and between two columns.
const ONE_COLUMN_GAP = 4
const TWO_COLUMN_GAP = 48

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
): Promise<OpenBook> => {
    const view = document.createElement('foliate-view') as FoliateView
    // Keys, edge clicks and the wheel turn pages on a desktop, and a click in
    // the middle shows the controls. Events inside
    // the book land in each section's own document and do not reach this
    // page, so every section document gets the same listeners as this page,
    // sharing one wheel gesture.
    let turning = pageTurn
    const scrolling = (): boolean => turning === 'scroll' && !view.isFixedLayout
    const turn = (turn: Turn): void => {
        onTurn()
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
    attachPageInput(document, () => ({ left: page().left, width: page().width, top: page().top, height: page().height }),
        gesture, turn, onMenu, onTurn, scroll)
    view.addEventListener('load', event => {
        const doc = (event as CustomEvent<{ doc: Document }>).detail.doc
        guardSelectionDrag(doc)
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
        }, gesture, turn, onMenu, onTurn, scroll)
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
    let shownMargins = margins
    const layOut = (): void => {
        if (view.isFixedLayout || !shownMargins) return
        const { width: outerWidth, height: outerHeight } = container.getBoundingClientRect()
        if (!outerWidth) return
        const { left, right, top, bottom } = shownMargins
        const twoColumns = outerWidth - left - right > COLUMN_WIDTH && outerWidth - left - right > outerHeight - top - bottom
        const gap = twoColumns ? TWO_COLUMN_GAP : ONE_COLUMN_GAP
        const padLeft = Math.max(0, left - gap)
        const padRight = Math.max(0, right - gap)
        container.style.padding = `${top}px ${padRight}px ${bottom}px ${padLeft}px`
        const share = `${(gap / (outerWidth - padLeft - padRight) * 100).toFixed(4)}%`
        if (view.renderer.getAttribute('gap') === share) return
        view.renderer.setAttribute('gap', share)
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
        setStyles,
        setMargins,
        setPageTurn(pageTurn) {
            turning = pageTurn
            applyPageTurn()
        },
        layout() {
            // The container may have been hidden when the margins were last set.
            layOut()
            const { width, height } = view.renderer.getBoundingClientRect()
            return `${Math.round(width)}x${Math.round(height)}|${view.renderer.getAttribute('flow') ?? ''}|${view.renderer.getAttribute('gap') ?? ''}|${shownStyles}`
        },
        async count(cancelled) {
            if (view.isFixedLayout) return null
            layOut()
            return countPages(view.renderer, view.book, shownStyles, hrefs, resolve,
                () => view.renderer.getContents?.()[0]?.index ?? -1, cancelled)
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
            view.renderer.addEventListener('relocate', event => {
                const reason = (event as CustomEvent<{ reason?: string }>).detail?.reason ?? ''
                const { fraction, cfi } = view.lastLocation ?? {}
                const previous = shown
                shown = cfi
                if (cfi === previous) return
                if (!NOT_MOVES.has(reason) && typeof fraction === 'number' && typeof cfi === 'string') onMoved({ cfi, fraction })
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
