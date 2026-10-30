// The only module that touches foliate-js.
import { SectionProgress } from '../../vendor/foliate-js/progress.js'
import '../../vendor/foliate-js/view.js'
import type { TocEntry } from '../controls/contents'
import type { Moved, StartAt } from '../position/position'
import { attachPageInput, type Turn, wheelGesture } from './input'
import { guardSelectionDrag } from './selection'

interface FoliateView extends HTMLElement {
    open(book: Blob): Promise<void>
    init(options: { lastLocation?: unknown, showTextStart?: boolean }): Promise<void>
    goTo(target: string): Promise<unknown>
    goToFraction(fraction: number): Promise<void>
    goToTextStart(): Promise<void>
    resolveNavigation(target: string): { index?: unknown } | undefined
    book: { sections: unknown[], metadata?: { title?: unknown }, toc?: TocEntry[] }
    next(): Promise<void>
    prev(): Promise<void>
    goLeft(): Promise<void>
    goRight(): Promise<void>
    renderer: HTMLElement
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
 * contents entry (null for none) and the fraction of the book.
 */
export interface Place {
    chapter: string
    href: string | null
    fraction: number
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
}

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
 */
export const openBook = async (
    container: HTMLElement,
    file: File,
    onView?: (view: EventTarget) => void,
    start: StartAt = null,
    onMenu: () => void = () => {},
    onTurn: () => void = () => {},
): Promise<OpenBook> => {
    const view = document.createElement('foliate-view') as FoliateView
    // Keys, edge clicks and the wheel turn pages on a desktop, and a click in
    // the middle shows the controls. Events inside
    // the book land in each section's own document and do not reach this
    // page, so every section document gets the same listeners as this page,
    // sharing one wheel gesture.
    const turn = (turn: Turn): void => {
        onTurn()
        void { next: () => view.next(), prev: () => view.prev(), left: () => view.goLeft(), right: () => view.goRight() }[turn]()
    }
    const gesture = wheelGesture()
    const page = (): DOMRect => container.getBoundingClientRect()
    attachPageInput(document, () => ({ left: page().left, width: page().width }), gesture, turn, onMenu, onTurn)
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
            return { left: (page().left - frame.left) / scale, width: page().width / scale }
        }, gesture, turn, onMenu, onTurn)
    })
    onView?.(view)
    container.replaceChildren(view)
    await view.open(file)
    view.renderer.setAttribute('flow', 'paginated')
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
    const place = (): Place => ({
        chapter: view.lastLocation?.tocItem?.label?.trim() ?? '',
        href: view.lastLocation?.tocItem?.href ?? null,
        fraction: view.lastLocation?.fraction ?? 0,
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
