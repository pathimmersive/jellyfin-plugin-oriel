import type { Highlight } from '../api/client'
import { type Colour, HIGHLIGHTERS, type Highlights, highlightText } from './highlights'

/** A box on screen, in the page's coordinates. */
export interface Box {
    left: number
    top: number
    right: number
    bottom: number
}

/** Text selected in the book: where it is, the fraction of the book of its page, its text, and its box on screen. */
export interface TextSelection {
    cfi: string
    fraction: number
    text: string
    box: Box
}

// The toolbar's least space from the screen's edges, its space from the text, and its width on a wider screen.
const EDGE = 16
const GAP = 8
const WIDE_WIDTH = 420

/**
 * Where the toolbar goes for the text in `around`, `height` tall, on a screen
 * `view`: below the text, or above it when there is no room below, never
 * covering it when either fits; across the screen 16 px from its sides on a
 * phone, and 420 px wide at the text on a wider screen.
 */
export const toolbarPlace = (around: Box, height: number, view: { width: number, height: number }, wide: boolean): { left: number, top: number, width: number } => {
    const width = wide ? Math.min(WIDE_WIDTH, view.width - 2 * EDGE) : view.width - 2 * EDGE
    const centre = (around.left + around.right) / 2
    const left = wide ? Math.max(EDGE, Math.min(centre - width / 2, view.width - EDGE - width)) : EDGE
    const below = around.bottom + GAP
    const above = around.top - GAP - height
    const top = below + height <= view.height - EDGE ? below
        : above >= EDGE ? above
            : Math.max(EDGE, view.height - EDGE - height)
    return { left, top, width }
}

/** What highlighting needs from the book. */
export interface HighlightingBook {
    /** Calls `selected` with the text selected, or null when none is, once a selection settles. */
    onSelect(selected: (selection: TextSelection | null) => void): void
    /** Calls `tapped` for a tap or click on the page with the highlight under it (null for none); true stops the tap there. */
    onTap(tapped: (cfi: string | null) => boolean): void
    /** Draws the highlights on the page, the one at `ringed` ringed. */
    showHighlights(highlights: { cfi: string, colour: string }[], ringed: string | null): void
    /** A highlight's box on screen, or null when it is not on the page. */
    boxOf(cfi: string): Box | null
    clearSelection(): void
}

/** Highlighting, as the page drives it. */
export interface Highlighting {
    /** Closes the toolbar, as a page turn does. */
    close(): void
    /** Closes the toolbar on Escape in another window: a section of the book. */
    watch(win: Pick<Window, 'addEventListener'>): void
}

const TRASH = 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z'

/**
 * The Selected text toolbar and what it does: selecting text shows it with the
 * highlighters, and a highlighter highlights the text; tapping a highlight
 * shows it with the highlight's highlighter pressed and Remove, and another
 * highlighter recolours it. A tap elsewhere, Escape or a page turn closes it.
 */
export const createHighlighting = (root: HTMLElement, book: HighlightingBook, highlights: Highlights, wide: () => boolean): Highlighting => {
    const bar = document.createElement('div')
    bar.id = 'selection-toolbar'
    bar.setAttribute('role', 'toolbar')
    bar.setAttribute('aria-label', 'Selected text')
    bar.dataset.controls = ''
    bar.hidden = true
    const group = document.createElement('div')
    group.className = 'highlighters'
    group.setAttribute('role', 'group')
    group.setAttribute('aria-label', 'Highlighters')
    const buttons = HIGHLIGHTERS.map(({ colour, name, solid }) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'highlighter'
        button.setAttribute('aria-label', `Highlight: ${name}`)
        button.dataset.colour = colour
        button.innerHTML = '<span class="dot"></span>'
        button.querySelector<HTMLElement>('.dot')!.style.background = solid
        button.addEventListener('click', () => choose(colour))
        group.append(button)
        return button
    })
    const actions = document.createElement('div')
    actions.className = 'actions'
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'remove'
    remove.innerHTML = `<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="${TRASH}"/></svg>Remove`
    actions.append(remove)
    bar.append(group, actions)
    // A mouse press on the toolbar leaves the selection in the book as it is.
    bar.addEventListener('mousedown', event => event.preventDefault())
    root.append(bar)

    // What the toolbar is for: the text selected, or a highlight tapped.
    let target: { selection: TextSelection } | { highlight: Highlight } | null = null
    const ringed = (): string | null => target && 'highlight' in target ? target.highlight.cfi : null
    const draw = (): void => book.showHighlights(highlights.all(), ringed())
    const show = (around: Box, pressed: Colour | null): void => {
        for (const button of buttons) {
            if (pressed) button.setAttribute('aria-pressed', String(button.dataset.colour === pressed))
            else button.removeAttribute('aria-pressed')
        }
        actions.hidden = !pressed
        bar.hidden = false
        const place = toolbarPlace(around, bar.offsetHeight, { width: window.innerWidth, height: window.innerHeight }, wide())
        bar.style.left = `${place.left}px`
        bar.style.top = `${place.top}px`
        bar.style.width = `${place.width}px`
    }
    const close = (): void => {
        const wasRinged = ringed()
        target = null
        bar.hidden = true
        if (wasRinged) draw()
    }
    const choose = (colour: Colour): void => {
        const chosen = target
        close()
        if (!chosen) return
        if ('selection' in chosen) {
            const { cfi, fraction, text } = chosen.selection
            book.clearSelection()
            void highlights.add(cfi, fraction, colour, highlightText(text))
        } else {
            void highlights.recolour(chosen.highlight.id, colour)
        }
    }
    remove.addEventListener('click', () => {
        const chosen = target
        close()
        if (chosen && 'highlight' in chosen) void highlights.remove(chosen.highlight.id)
    })

    highlights.onChange(draw)
    book.onSelect(selection => {
        if (selection) {
            const wasRinged = ringed()
            target = { selection }
            if (wasRinged) draw()
            show(selection.box, null)
        } else if (target && 'selection' in target) {
            close()
        }
    })
    book.onTap(cfi => {
        const highlight = cfi ? highlights.at(cfi) : null
        const box = highlight && book.boxOf(highlight.cfi)
        if (highlight && box) {
            target = { highlight }
            draw()
            show(box, highlight.colour as Colour)
            return true
        }
        if (bar.hidden) return false
        close()
        return true
    })
    const watch = (win: Pick<Window, 'addEventListener'>): void => win.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || bar.hidden) return
        close()
        book.clearSelection()
    })
    watch(window)
    return { close, watch }
}
