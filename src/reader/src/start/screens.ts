import { landscapeMargins, type Margins, marginsFor, type Settings } from '../settings/settings'

/** The kinds of screen the reader lays out for. */
export interface Screens {
    /** A phone or a wider screen, for the margins the reader has not changed. */
    wide: MediaQueryList
    /** A desktop, where a panel opens beside the book and the book moves clear of it. */
    desk: MediaQueryList
    /** A phone on its side, where the book is one column clear of the notch. */
    sideways: MediaQueryList
    /** The margins around the text in `book` on this screen. */
    margins(settings: Settings): Margins
}

export const createScreens = (book: HTMLElement): Screens => {
    const wide = matchMedia('(min-width: 600px)')
    const desk = matchMedia('(min-width: 600px) and (min-height: 501px)')
    const sideways = matchMedia('(orientation: landscape) and (max-height: 500px)')
    return {
        wide,
        desk,
        sideways,
        margins(settings) {
            if (!sideways.matches) return marginsFor(settings, wide.matches)
            const area = getComputedStyle(book)
            return landscapeMargins(settings, { left: parseFloat(area.left) || 0, right: parseFloat(area.right) || 0 })
        },
    }
}
