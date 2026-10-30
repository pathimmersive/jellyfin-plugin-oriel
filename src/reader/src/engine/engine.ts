// The only module that touches foliate-js.
import '../../vendor/foliate-js/view.js'
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
    book: { sections: unknown[] }
    next(): Promise<void>
    prev(): Promise<void>
    goLeft(): Promise<void>
    goRight(): Promise<void>
    renderer: HTMLElement
    lastLocation?: { fraction?: number, cfi?: string }
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
     * Re-placing the same position (on opening or on a resize) and selecting
     * text are not moves.
     */
    onMoved(onMoved: (position: Moved) => void): void
}

// The paginator's reasons for re-placing the current position rather than moving.
const NOT_MOVES = new Set(['anchor', 'selection'])

/**
 * Opens a book file in a new paged foliate-js view inside `container`, at
 * `start` (an exact CFI or a fraction of the book) when given, else at the
 * start of the text. `onView` receives the view before the book opens, so a
 * listener sees the first section; the view emits `load` (a section document)
 * and `relocate`.
 */
export const openBook = async (
    container: HTMLElement,
    file: File,
    onView?: (view: EventTarget) => void,
    start: StartAt = null,
): Promise<OpenBook> => {
    const view = document.createElement('foliate-view') as FoliateView
    // Keys, edge clicks and the wheel turn pages on a desktop. Events inside
    // the book land in each section's own document and do not reach this
    // page, so every section document gets the same listeners as this page,
    // sharing one wheel gesture.
    const turn = (turn: Turn): void => {
        void { next: () => view.next(), prev: () => view.prev(), left: () => view.goLeft(), right: () => view.goRight() }[turn]()
    }
    const gesture = wheelGesture()
    const page = (): DOMRect => container.getBoundingClientRect()
    attachPageInput(document, () => ({ left: page().left, width: page().width }), gesture, turn)
    view.addEventListener('load', event => {
        const doc = (event as CustomEvent<{ doc: Document }>).detail.doc
        guardSelectionDrag(doc)
        attachPageInput(doc, () => {
            // A click's position in the section's frame, measured from the page.
            const frame = doc.defaultView?.frameElement?.getBoundingClientRect()
            return frame ? { left: page().left - frame.left, width: page().width } : null
        }, gesture, turn)
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
    const opened: OpenBook = {
        openedAt: view.lastLocation?.cfi ?? null,
        placed,
        async reopen(fraction) {
            if (fraction === null) await view.goToTextStart()
            else await view.goToFraction(fraction)
            opened.openedAt = view.lastLocation?.cfi ?? null
        },
        onMoved(onMoved) {
            // The view handles the renderer's relocate first and updates
            // lastLocation with the CFI and the fraction of the whole book.
            view.renderer.addEventListener('relocate', event => {
                const reason = (event as CustomEvent<{ reason?: string }>).detail?.reason ?? ''
                const { fraction, cfi } = view.lastLocation ?? {}
                if (!NOT_MOVES.has(reason) && typeof fraction === 'number' && typeof cfi === 'string') onMoved({ cfi, fraction })
            })
        },
    }
    return opened
}

// Goes to a saved CFI; false when it is not a place in this book. foliate-js
// resolves a CFI to a section index without checking it, and its goTo returns
// nothing when it cannot go there.
const placeCfi = async (view: FoliateView, cfi: string): Promise<boolean> => {
    const index = view.resolveNavigation(cfi)?.index
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= view.book.sections.length) return false
    return (await view.goTo(cfi)) !== undefined
}
