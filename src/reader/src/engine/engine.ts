// The only module that touches foliate-js.
import '../../vendor/foliate-js/view.js'

interface FoliateView extends HTMLElement {
    open(book: Blob): Promise<void>
    init(options: { lastLocation?: unknown, showTextStart?: boolean }): Promise<void>
    renderer: HTMLElement
}

/**
 * Opens a book file in a new paged foliate-js view inside `container`.
 * `onView` receives the view before the book opens, so a listener sees the
 * first section; the view emits `load` (a section document) and `relocate`.
 */
export const openBook = async (container: HTMLElement, file: File, onView?: (view: EventTarget) => void): Promise<void> => {
    const view = document.createElement('foliate-view') as FoliateView
    onView?.(view)
    container.replaceChildren(view)
    await view.open(file)
    view.renderer.setAttribute('flow', 'paginated')
    await view.init({ showTextStart: true })
}
