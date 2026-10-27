// The only module that touches foliate-js.
import '../../vendor/foliate-js/view.js'
import type { Moved, StartAt } from '../position/position'
import { guardSelectionDrag } from './selection'

interface FoliateView extends HTMLElement {
    open(book: Blob): Promise<void>
    init(options: { lastLocation?: unknown, showTextStart?: boolean }): Promise<void>
    goTo(target: string): Promise<unknown>
    goToFraction(fraction: number): Promise<void>
    renderer: HTMLElement
    lastLocation?: { fraction?: number, cfi?: string }
}

export interface OpenBook {
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
    view.addEventListener('load', event => guardSelectionDrag((event as CustomEvent<{ doc: Document }>).detail.doc))
    onView?.(view)
    container.replaceChildren(view)
    await view.open(file)
    view.renderer.setAttribute('flow', 'paginated')
    // The paginator can place a position only once it knows the page count,
    // which the first render works out; placed any earlier, the view stays on
    // its blank lead page. So open at the text start, then move to the saved
    // position. The move is a re-placement ('anchor'), not a move to save.
    await view.init({ showTextStart: true })
    if (start && 'cfi' in start) await view.goTo(start.cfi)
    else if (start) await view.goToFraction(start.fraction)
    return {
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
}
