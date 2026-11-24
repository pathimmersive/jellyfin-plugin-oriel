// The panel beside the page on a desktop, as reader.css draws it.
const PANEL_WIDTH = 440

/** What laying the book out beside a panel needs. */
export interface SidePanelOptions {
    /** A desktop, where a panel opens beside the book. */
    desk: MediaQueryList
    /** Keeps the book clear of a panel this many px wide at the right; 0 for none. */
    setPanel(width: number): void
    /** A panel is about to open. */
    opening(): void
    /** The book is laid out again. */
    relaid(): void
}

/** Whether a panel is open beside the page, and whether the book is laid out beside it. */
export interface SidePanel {
    /** A panel opened or closed. */
    show(open: boolean): void
    /** Whether the book is laid out beside a panel. */
    beside(): boolean
}

/**
 * The book's pages are those of its layout without the panel: while it lays
 * out beside one, the count and the page numbers shown stay those of the
 * layout without it.
 */
export const createSidePanel = (options: SidePanelOptions): SidePanel => {
    let panelOpen = false
    const beside = (): boolean => panelOpen && options.desk.matches
    const lay = (): void => {
        options.setPanel(beside() ? PANEL_WIDTH : 0)
        options.relaid()
    }
    options.desk.addEventListener('change', lay)
    return {
        show(open) {
            if (open) options.opening()
            panelOpen = open
            lay()
        },
        beside,
    }
}
