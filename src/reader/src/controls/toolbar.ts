import type { Highlight } from '../api/client'
import { definable } from './dictionary'
import type { HighlighterSheet } from './highlighter-sheet'
import { highlightFill, type Highlighters, MAX_HIGHLIGHTERS } from './highlighters'
import { type Highlights, highlightText, NOTE_LENGTH } from './highlights'

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
    /** Draws the highlights on the page, each in its highlighter's colour and strength, the one at `ringed` ringed. */
    showHighlights(highlights: { cfi: string, colour: string, solid: string, fill: number }[], ringed: string | null): void
    /** A highlight's box on screen, or null when it is not on the page. */
    boxOf(cfi: string): Box | null
    clearSelection(): void
}

/** What the toolbar's second row needs from the page. */
export interface SelectionActions {
    /** The book's title, which Share sends with the text. */
    title: string
    /** The translation address, with {text} where the text goes; empty when Translate is off. */
    translateUrl(): string
    /** Opens Search in this book with a query; null for a book without search. */
    search: ((query: string) => void) | null
    /** Puts text on the clipboard and says so. */
    copy(text: string): void
    /** Opens the Dictionary sheet for a word or short phrase; null where there is no dictionary. */
    define: ((text: string) => void) | null
}

/** The address Translate opens for `text`: the translation address with the text, URL-encoded, where {text} is. */
export const translateAddress = (template: string, text: string): string =>
    template.split('{text}').join(encodeURIComponent(text))

// Puts text on the clipboard: the clipboard API where the browser offers it (a
// secure page), else a selected, hidden field copied the old way, which also
// works on a server reached over plain http.
const copyText = (text: string): Promise<boolean> => {
    const copyOldWay = (): boolean => {
        const field = document.createElement('textarea')
        field.value = text
        field.setAttribute('readonly', '')
        field.style.cssText = 'position: fixed; top: 0; left: 0; opacity: 0'
        document.body.append(field)
        field.select()
        field.setSelectionRange(0, text.length)
        let copied = false
        try {
            copied = document.execCommand('copy')
        } catch {
            copied = false
        }
        field.remove()
        return copied
    }
    if (window.isSecureContext && navigator.clipboard) return navigator.clipboard.writeText(text).then(() => true, copyOldWay)
    return Promise.resolve(copyOldWay())
}

/** Copy, for the toolbar and the sheets: puts text on the clipboard and says 'Copied' for a moment. */
export const createCopy = (root: HTMLElement): (text: string) => void => {
    const copied = document.createElement('div')
    copied.id = 'copied'
    copied.setAttribute('role', 'status')
    copied.dataset.controls = ''
    root.append(copied)
    let copiedFor = 0
    return text => {
        void copyText(text).then(done => {
            if (!done) return
            copied.textContent = 'Copied'
            clearTimeout(copiedFor)
            copiedFor = window.setTimeout(() => { copied.textContent = '' }, 2000)
        })
    }
}

/** Highlighting, as the page drives it. */
export interface Highlighting {
    /** Closes the toolbar, as a page turn does. */
    close(): void
    /** Closes the toolbar on Escape in another window: a section of the book. */
    watch(win: Pick<Window, 'addEventListener'>): void
}

const TRASH = 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z'
const COPY = 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z'
const DEFINE = 'M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zm0 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z'
const TRANSLATE = 'M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z'
const SEARCH = 'M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z'
const SHARE = 'M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z'
const NOTE = 'M3 18h12v-2H3v2zM3 6v2h18V6H3zm0 7h18v-2H3v2z'
const PLUS = 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z'
const CLOSE = 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'

const svg = (path: string, size: number): string =>
    `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor"><path d="${path}"/></svg>`

// Fills `group` with a dot button for each highlighter, named 'Highlight: <name>',
// calling `chosen` with its id, the one `pressed` pressed (none pressed for
// null, no aria-pressed at all for undefined), and then 'Add a highlighter'
// while there is room for another.
const fillHighlighters = (group: HTMLElement, highlighters: Highlighters, pressed: string | null | undefined, chosen: (id: string) => void, add: () => void): void => {
    group.replaceChildren(...highlighters.list().map(({ id, name, solid }) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'highlighter'
        button.setAttribute('aria-label', `Highlight: ${name}`)
        button.dataset.colour = id
        if (pressed !== undefined) button.setAttribute('aria-pressed', String(id === pressed))
        button.innerHTML = '<span class="dot"></span>'
        button.querySelector<HTMLElement>('.dot')!.style.background = solid
        button.addEventListener('click', () => chosen(id))
        return button
    }))
    if (highlighters.list().length >= MAX_HIGHLIGHTERS) return
    const more = document.createElement('button')
    more.type = 'button'
    more.className = 'add-highlighter'
    more.setAttribute('aria-label', 'Add a highlighter')
    more.innerHTML = `<span>${svg(PLUS, 16)}</span>`
    more.addEventListener('click', add)
    group.append(more)
}

/**
 * The Selected text toolbar and what it does: selecting text shows it with the
 * highlighters, and a highlighter highlights the text; tapping a highlight
 * shows it with the highlight's highlighter pressed and Remove, and another
 * highlighter recolours it. A tap elsewhere, Escape or a page turn closes it.
 * Its Note (Edit note for a highlight with one) opens the Note sheet, where
 * Save keeps the note with the highlight, making the highlight for a selection.
 * Add a highlighter, after the highlighters on both, opens the New highlighter
 * sheet; the new one highlights the selection (or recolours the highlight) from
 * the toolbar, and is pressed on the Note sheet. Below a divider, Copy, Define,
 * Translate, Search and Share act on the text (Define for up to three words,
 * Translate where the admin has set an address, Share where the browser has a
 * share sheet), and Remove follows them for a highlight.
 */
export const createHighlighting = (root: HTMLElement, book: HighlightingBook, highlights: Highlights, highlighters: Highlighters, sheetOf: HighlighterSheet, wide: () => boolean, actions: SelectionActions): Highlighting => {
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
    const noteButton = document.createElement('button')
    noteButton.type = 'button'
    noteButton.className = 'note'
    noteButton.innerHTML = `${svg(NOTE, 20)}<span></span>`
    const top = document.createElement('div')
    top.className = 'top'
    top.append(group, noteButton)
    const row = document.createElement('div')
    row.className = 'actions'
    const action = (name: string, path: string): HTMLButtonElement => {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'action'
        button.innerHTML = `${svg(path, 22)}<span></span>`
        button.querySelector('span')!.textContent = name
        row.append(button)
        return button
    }
    const copy = action('Copy', COPY)
    const define = action('Define', DEFINE)
    const translate = action('Translate', TRANSLATE)
    const search = action('Search', SEARCH)
    const share = action('Share', SHARE)
    const remove = action('Remove', TRASH)
    bar.append(top, row)
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
    const noteGroup = sheet.querySelector<HTMLElement>('.highlighters')!
    let notePressed = 'yellow'
    const pressNote = (id: string): void => {
        notePressed = highlighters.find(id).id
        fillHighlighters(noteGroup, highlighters, notePressed, pressNote, () => sheetOf.open(null, added => { if (added) pressNote(added) }))
        quote.style.background = highlightFill(highlighters.find(notePressed))
    }
    sheetBackdrop.hidden = true
    sheet.hidden = true
    root.append(bar, sheetBackdrop, sheet)

    // What the toolbar is for: the text selected, or a highlight tapped.
    type Target = { selection: TextSelection } | { highlight: Highlight }
    let target: Target | null = null
    const ringed = (): string | null => target && 'highlight' in target ? target.highlight.cfi : null
    const draw = (): void => book.showHighlights(highlights.all().map(({ cfi, colour }) => {
        const { id, solid, fill } = highlighters.find(colour)
        return { cfi, colour: id, solid, fill }
    }), ringed())
    // The highlighter pressed while the toolbar shows: the highlight's, or none for a selection.
    let pressed: string | null = null
    const fillBar = (): void => fillHighlighters(group, highlighters, pressed ?? undefined, id => choose(id), addFromBar)
    const show = (around: Box, text: string, pressedNow: string | null, noted = false): void => {
        pressed = pressedNow
        fillBar()
        noteButton.querySelector('span')!.textContent = noted ? 'Edit note' : 'Note'
        define.hidden = !actions.define || !definable(text)
        translate.hidden = !actions.translateUrl()
        search.hidden = !actions.search
        share.hidden = typeof navigator.share !== 'function'
        remove.hidden = !pressedNow
        row.style.gridTemplateColumns = `repeat(${[...row.children].filter(button => !(button as HTMLElement).hidden).length}, minmax(0, 1fr))`
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
    const choose = (colour: string, chosen = target): void => {
        if (chosen === target) close()
        if (!chosen) return
        if ('selection' in chosen) {
            const { cfi, fraction, text } = chosen.selection
            book.clearSelection()
            void highlights.add(cfi, fraction, colour, highlightText(text))
        } else {
            void highlights.update(chosen.highlight.id, { colour })
        }
    }
    // A new highlighter from the toolbar highlights the selection, or recolours the highlight, in it.
    const addFromBar = (): void => {
        const chosen = target
        close()
        sheetOf.open(null, added => {
            if (added && chosen) choose(added, chosen)
            else if (chosen && 'selection' in chosen) book.clearSelection()
        })
    }
    // An action acts on the text selected, or the highlight's, then closes the toolbar and lets go of the selection.
    const act = (use: (text: string) => void): void => {
        const chosen = target
        close()
        if (!chosen) return
        if ('selection' in chosen) book.clearSelection()
        use('selection' in chosen ? chosen.selection.text : chosen.highlight.text)
    }
    copy.addEventListener('click', () => act(text => actions.copy(text)))
    define.addEventListener('click', () => act(text => actions.define?.(text)))
    translate.addEventListener('click', () => act(text => {
        window.open(translateAddress(actions.translateUrl(), text), '_blank', 'noopener')
    }))
    search.addEventListener('click', () => act(text => actions.search?.(text)))
    share.addEventListener('click', () => act(text => {
        void navigator.share({ title: actions.title, text }).catch(() => {})
    }))
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
        pressNote(highlight ? highlight.colour : 'yellow')
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
    highlighters.onChange(() => {
        draw()
        if (!bar.hidden) fillBar()
        if (!sheet.hidden) pressNote(notePressed)
    })
    book.onSelect(selection => {
        if (selection) {
            const wasRinged = ringed()
            target = { selection }
            if (wasRinged) draw()
            show(selection.box, selection.text, null)
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
            show(box, highlight.text, highlighters.find(highlight.colour).id, highlight.note !== '')
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
