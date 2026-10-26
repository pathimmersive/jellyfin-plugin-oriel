/** The parts of a section document the guard needs. */
export interface SectionDocument {
    defaultView: Pick<Window, 'addEventListener'> | null
    getSelection(): Pick<Selection, 'isCollapsed' | 'rangeCount'> | null
}

/**
 * Keeps foliate-js's paginator from taking a one-finger drag as a page swipe
 * while text is selected in a section, so the drag can extend the selection.
 * The listener runs in the capture phase on the section's window, ahead of the
 * paginator's listener on the document, and stops the event there without
 * cancelling it, so the browser still moves the selection handle.
 */
export const guardSelectionDrag = (doc: SectionDocument): void => {
    doc.defaultView?.addEventListener('touchmove', event => {
        const selection = doc.getSelection()
        if (selection && selection.rangeCount > 0 && !selection.isCollapsed) event.stopPropagation()
    }, { capture: true })
}
