import type { Highlight } from '../api/client'
import { definable } from './dictionary'
import type { HighlighterSheet } from './highlighter-sheet'
import { highlightFill, type Highlighters, MAX_HIGHLIGHTERS } from './highlighters'
import { type Highlights, highlightText, NOTE_LENGTH } from './highlights'
import { icon, ICONS } from './icons'

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

// The toolbar's least space from the screen's edges, its space from the text
// (more on a touch screen, clear of the selection handles Android draws in the
// 24 px below a line), and its width on a wider screen.
const EDGE = 16
const GAP = 8
const TOUCH_GAP = 32
const WIDE_WIDTH = 420

/**
 * Where the toolbar goes for the text in `around`, `height` tall, on a screen
 * `view`: below the text, or above it when there is no room below, never
 * covering it when either fits, 8 px from it or 32 px on a `touch` screen;
 * across the screen 16 px from its sides on a phone, and 420 px wide at the
 * text on a wider screen.
 */
export const toolbarPlace = (around: Box, height: number, view: { width: number, height: number }, wide: boolean, touch = false): { left: number, top: number, width: number } => {
    const gap = touch ? TOUCH_GAP : GAP
    const width = wide ? Math.min(WIDE_WIDTH, view.width - 2 * EDGE) : view.width - 2 * EDGE
    const centre = (around.left + around.right) / 2
    const left = wide ? Math.max(EDGE, Math.min(centre - width / 2, view.width - EDGE - width)) : EDGE
    const below = around.bottom + gap
    const above = around.top - gap - height
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
    more.innerHTML = `<span>${icon(ICONS.plus, 16)}</span>`
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
export const createHighlighting = (root: HTMLElement, book: HighlightingBook, highlights: Highlights, highlighters: Highlighters, sheetOf: HighlighterSheet, wide: () => boolean, actions: SelectionActions, touch: () => boolean = () => false): Highlighting => {
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
    noteButton.innerHTML = `${icon(ICONS.note, 20)}<span></span>`
    const top = document.createElement('div')
    top.className = 'top'
    top.append(group, noteButton)
    const row = document.createElement('div')
    row.className = 'actions'
    const action = (name: string, path: string): HTMLButtonElement => {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'action'
        button.innerHTML = `${icon(path, 22)}<span></span>`
        button.querySelector('span')!.textContent = name
        row.append(button)
        return button
    }
    const copy = action('Copy', ICONS.copy)
    const define = action('Define', ICONS.define)
    const translate = action('Translate', ICONS.translate)
    const search = action('Search', ICONS.search)
    const share = action('Share', ICONS.share)
    const remove = action('Remove', ICONS.trash)
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
    sheet.innerHTML = `<div class="panel-header"><h2>Note</h2><button type="button" class="icon-button" aria-label="Close">${icon(ICONS.close)}</button></div>`
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
    const sameTarget = (a: Target, b: Target): boolean => a === b
        || ('selection' in a && 'selection' in b && a.selection.cfi === b.selection.cfi)
    const ringed = (): string | null => target && 'highlight' in target ? target.highlight.cfi : null
    const draw = (): void => book.showHighlights(highlights.all().map(({ cfi, colour }) => {
        const { id, solid, fill } = highlighters.find(colour)
        return { cfi, colour: id, solid, fill }
    }), ringed())
    // The highlighter pressed while the toolbar shows: the highlight's, or none for a selection.
    let pressed: string | null = null
    const fillBar = (): void => fillHighlighters(group, highlighters, pressed ?? undefined, id => void choose(id), addFromBar)
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
        const place = toolbarPlace(around, bar.offsetHeight, { width: window.innerWidth, height: window.innerHeight }, wide(), touch())
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
    // Keeps a highlight in a colour; false when it could not be kept, and not because of the limit.
    const keep = async (chosen: Target, colour: string, note?: string): Promise<boolean> => {
        if ('highlight' in chosen) return highlights.update(chosen.highlight.id, note === undefined ? { colour } : { colour, note })
        const { cfi, fraction, text } = chosen.selection
        return await highlights.add(cfi, fraction, colour, highlightText(text), note) !== false
    }
    // The toolbar stays until the highlight is kept, so one that is not can be tried again.
    let choosing = false
    const choose = async (colour: string, chosen = target, reopen = false): Promise<void> => {
        if (!chosen || choosing) return
        choosing = true
        const kept = await keep(chosen, colour)
        choosing = false
        if (!kept) {
            // Closed for the New highlighter sheet, it comes back for its selection or highlight.
            if (reopen && !target) showFor(chosen)
            return
        }
        // Text selected since, or another highlight tapped, is left as it is.
        const replaced = target !== null && !sameTarget(target, chosen)
        if (replaced) return
        if (target) close()
        if ('selection' in chosen) book.clearSelection()
    }
    // A new highlighter from the toolbar highlights the selection, or recolours the highlight, in it.
    const addFromBar = (): void => {
        const chosen = target
        close()
        sheetOf.open(null, added => {
            if (added && chosen) void choose(added, chosen, true)
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
    // The sheet stays until the note is kept, so one that is not is not lost.
    const save = sheet.querySelector<HTMLButtonElement>('.save')!
    const saveNote = async (): Promise<void> => {
        const chosen = noting
        if (!chosen) return
        save.disabled = true
        const kept = await keep(chosen, notePressed, field.value.trim())
        save.disabled = false
        if (kept && noting === chosen) closeNote()
    }
    save.addEventListener('click', () => { void saveNote() })
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
    // Shows the toolbar for text selected, or a highlight on the page; false for a highlight that is not.
    const showFor = (chosen: Target): boolean => {
        if ('selection' in chosen) {
            target = chosen
            show(chosen.selection.box, chosen.selection.text, null)
            return true
        }
        const { highlight } = chosen
        const box = book.boxOf(highlight.cfi)
        if (!box) return false
        target = chosen
        draw()
        show(box, highlight.text, highlighters.find(highlight.colour).id, highlight.note !== '')
        return true
    }
    book.onTap(cfi => {
        const highlight = cfi ? highlights.at(cfi) : null
        if (highlight && showFor({ highlight })) return true
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
