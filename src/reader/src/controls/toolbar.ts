import type { Highlight } from '../api/client'
import { type Colour, HIGHLIGHTERS, highlighter, highlightFill, type Highlights, highlightText, NOTE_LENGTH } from './highlights'

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
const NOTE = 'M3 18h12v-2H3v2zM3 6v2h18V6H3zm0 7h18v-2H3v2z'
const CLOSE = 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'

const svg = (path: string, size: number): string =>
    `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor"><path d="${path}"/></svg>`

// A dot button for each highlighter, named 'Highlight: <name>', calling `chosen` with its colour.
const highlighterButtons = (group: HTMLElement, chosen: (colour: Colour) => void): HTMLButtonElement[] => HIGHLIGHTERS.map(({ colour, name, solid }) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'highlighter'
    button.setAttribute('aria-label', `Highlight: ${name}`)
    button.dataset.colour = colour
    button.innerHTML = '<span class="dot"></span>'
    button.querySelector<HTMLElement>('.dot')!.style.background = solid
    button.addEventListener('click', () => chosen(colour))
    group.append(button)
    return button
})

/**
 * The Selected text toolbar and what it does: selecting text shows it with the
 * highlighters, and a highlighter highlights the text; tapping a highlight
 * shows it with the highlight's highlighter pressed and Remove, and another
 * highlighter recolours it. A tap elsewhere, Escape or a page turn closes it.
 * Its Note (Edit note for a highlight with one) opens the Note sheet, where
 * Save keeps the note with the highlight, making the highlight for a selection.
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
    const buttons = highlighterButtons(group, colour => choose(colour))
    const noteButton = document.createElement('button')
    noteButton.type = 'button'
    noteButton.className = 'note'
    noteButton.innerHTML = `${svg(NOTE, 20)}<span></span>`
    const top = document.createElement('div')
    top.className = 'top'
    top.append(group, noteButton)
    const actions = document.createElement('div')
    actions.className = 'actions'
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'remove'
    remove.innerHTML = `${svg(TRASH, 22)}Remove`
    actions.append(remove)
    bar.append(top, actions)
    // A mouse press on the toolbar leaves the selection in the book as it is.
    bar.addEventListener('mousedown', event => event.preventDefault())

    // The Note sheet: the text in the highlighter pressed, the highlighters, the note, Cancel and Save.
    const sheetBackdrop = document.createElement('div')
    sheetBackdrop.id = 'note-backdrop'
    sheetBackdrop.dataset.controls = ''
    const sheet = document.createElement('section')
    sheet.id = 'note'
    sheet.dataset.controls = ''
    sheet.setAttribute('aria-label', 'Note')
    sheet.innerHTML = `<div class="panel-header"><h2>Note</h2><button type="button" class="icon-button" aria-label="Close">${svg(CLOSE, 24)}</button></div>`
        + '<div class="panel-body"><p class="quote"><mark></mark></p><div class="highlighters" role="group" aria-label="Highlighters"></div>'
        + `<label class="field">Note<textarea rows="4" maxlength="${NOTE_LENGTH}"></textarea></label>`
        + '<div class="sheet-buttons"><button type="button" class="cancel">Cancel</button><button type="button" class="save">Save</button></div></div>'
    const quote = sheet.querySelector('mark')!
    const field = sheet.querySelector('textarea')!
    let notePressed: Colour = 'yellow'
    const pressNote = (colour: Colour): void => {
        notePressed = colour
        for (const button of noteButtons) button.setAttribute('aria-pressed', String(button.dataset.colour === colour))
        quote.style.background = highlightFill(highlighter(colour))
    }
    const noteButtons = highlighterButtons(sheet.querySelector<HTMLElement>('.highlighters')!, pressNote)
    sheetBackdrop.hidden = true
    sheet.hidden = true
    root.append(bar, sheetBackdrop, sheet)

    // What the toolbar is for: the text selected, or a highlight tapped.
    type Target = { selection: TextSelection } | { highlight: Highlight }
    let target: Target | null = null
    const ringed = (): string | null => target && 'highlight' in target ? target.highlight.cfi : null
    const draw = (): void => book.showHighlights(highlights.all(), ringed())
    const show = (around: Box, pressed: Colour | null, noted = false): void => {
        for (const button of buttons) {
            if (pressed) button.setAttribute('aria-pressed', String(button.dataset.colour === pressed))
            else button.removeAttribute('aria-pressed')
        }
        noteButton.querySelector('span')!.textContent = noted ? 'Edit note' : 'Note'
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
            void highlights.update(chosen.highlight.id, { colour })
        }
    }
    remove.addEventListener('click', () => {
        const chosen = target
        close()
        if (chosen && 'highlight' in chosen) void highlights.remove(chosen.highlight.id)
    })

    // What the Note sheet is for, while it shows.
    let noting: Target | null = null
    // Closing it lets go of a selection it was for, saved or not.
    const closeNote = (): void => {
        if (noting && 'selection' in noting) book.clearSelection()
        noting = null
        sheet.hidden = true
        sheetBackdrop.hidden = true
    }
    noteButton.addEventListener('click', () => {
        const chosen = target
        close()
        if (!chosen) return
        noting = chosen
        const highlight = 'highlight' in chosen ? chosen.highlight : null
        quote.textContent = 'selection' in chosen ? highlightText(chosen.selection.text) : chosen.highlight.text
        pressNote(highlight ? highlighter(highlight.colour).colour : 'yellow')
        field.value = highlight?.note ?? ''
        sheet.hidden = false
        sheetBackdrop.hidden = false
        field.focus()
    })
    sheet.querySelector('.save')!.addEventListener('click', () => {
        const chosen = noting
        closeNote()
        if (!chosen) return
        const note = field.value.trim()
        if ('selection' in chosen) {
            const { cfi, fraction, text } = chosen.selection
            void highlights.add(cfi, fraction, notePressed, highlightText(text), note)
        } else {
            void highlights.update(chosen.highlight.id, { colour: notePressed, note })
        }
    })
    for (const dismiss of [sheet.querySelector('.cancel')!, sheet.querySelector('.panel-header button')!, sheetBackdrop]) {
        dismiss.addEventListener('click', closeNote)
    }

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
            show(box, highlighter(highlight.colour).colour, highlight.note !== '')
            return true
        }
        if (bar.hidden) return false
        close()
        return true
    })
    const watch = (win: Pick<Window, 'addEventListener'>): void => win.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return
        if (!sheet.hidden) {
            closeNote()
            return
        }
        if (bar.hidden) return
        close()
        book.clearSelection()
    })
    watch(window)
    return { close, watch }
}
