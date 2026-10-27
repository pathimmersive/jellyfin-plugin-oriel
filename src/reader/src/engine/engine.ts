// The only module that touches foliate-js.
import '../../vendor/foliate-js/view.js'
import { guardSelectionDrag } from './selection'

interface FoliateView extends HTMLElement {
    open(book: Blob): Promise<void>
    init(options: { lastLocation?: unknown, showTextStart?: boolean }): Promise<void>
    renderer: HTMLElement
    lastLocation?: { fraction?: number }
}

export interface OpenBook {
    /**
     * Calls `onMoved` with the fraction of the book now shown whenever the
     * reader moves: a page turn, a swipe or a link. Re-placing the same position
     * (on opening or on a resize) and selecting text are not moves.
     */
    onMoved(onMoved: (fraction: number) => void): void
}

// The paginator's reasons for re-placing the current position rather than moving.
const NOT_MOVES = new Set(['anchor', 'selection'])

/**
 * Opens a book file in a new paged foliate-js view inside `container`, at
 * `startFraction` of the way through when given, else at the start of the text.
 * `onView` receives the view before the book opens, so a listener sees the
 * first section; the view emits `load` (a section document) and `relocate`.
 */
export const openBook = async (
    container: HTMLElement,
    file: File,
    onView?: (view: EventTarget) => void,
    startFraction: number | null = null,
): Promise<OpenBook> => {
    const view = document.createElement('foliate-view') as FoliateView
    view.addEventListener('load', event => guardSelectionDrag((event as CustomEvent<{ doc: Document }>).detail.doc))
    onView?.(view)
    container.replaceChildren(view)
    await view.open(file)
    view.renderer.setAttribute('flow', 'paginated')
    await view.init(startFraction === null
        ? { showTextStart: true }
        : { lastLocation: { fraction: startFraction } })
    return {
        onMoved(onMoved) {
            // The view handles the renderer's relocate first and updates
            // lastLocation with the fraction of the whole book.
            view.renderer.addEventListener('relocate', event => {
                const reason = (event as CustomEvent<{ reason?: string }>).detail?.reason ?? ''
                const fraction = view.lastLocation?.fraction
                if (!NOT_MOVES.has(reason) && typeof fraction === 'number') onMoved(fraction)
            })
        },
    }
}
