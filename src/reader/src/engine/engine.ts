// The only module that touches foliate-js.
import '../../vendor/foliate-js/view.js'

interface FoliateView extends HTMLElement {
    open(book: Blob): Promise<void>
    init(options: { lastLocation?: unknown, showTextStart?: boolean }): Promise<void>
    renderer: HTMLElement
}

/** Opens a book file in a new paged foliate-js view inside `container`. */
export const openBook = async (container: HTMLElement, file: File): Promise<void> => {
    const view = document.createElement('foliate-view') as FoliateView
    container.replaceChildren(view)
    await view.open(file)
    view.renderer.setAttribute('flow', 'paginated')
    await view.init({ showTextStart: true })
}
