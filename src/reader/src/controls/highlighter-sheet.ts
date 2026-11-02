import { firstUnused, highlightFill, type Highlighter, type HighlighterEdit, highlighterName, type Highlighters, NAME_LENGTH, SWATCHES } from './highlighters'

/** The New highlighter sheet, also Edit highlighter. */
export interface HighlighterSheet {
    /**
     * Opens the sheet for a new highlighter, or to edit `editing`; `done` is
     * called with the highlighter's id once it is kept, or null when the sheet
     * closes without keeping one.
     */
    open(editing: Highlighter | null, done?: (id: string | null) => void): void
}

const CLOSE = 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'

/**
 * The sheet that adds or edits a highlighter, as the canvas's PhoneHlColor
 * draws it: its name (optional), one of twelve colours or another, a preview,
 * and Cancel and Add highlighter (Save when editing). It opens over whatever
 * opened it, and Escape, Close, Cancel or a tap beside it close it.
 */
export const createHighlighterSheet = (root: HTMLElement, highlighters: Highlighters): HighlighterSheet => {
    const backdrop = document.createElement('div')
    backdrop.id = 'highlighter-backdrop'
    backdrop.dataset.controls = ''
    const sheet = document.createElement('section')
    sheet.id = 'highlighter'
    sheet.dataset.controls = ''
    sheet.innerHTML = `<div class="panel-header"><h2></h2><button type="button" class="icon-button" aria-label="Close"><svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="${CLOSE}"/></svg></button></div>`
        + `<div class="panel-body"><label class="field">Name (optional)<input type="text" maxlength="${NAME_LENGTH}" placeholder="For example: Quotes" autocomplete="off"></label>`
        + '<div class="swatches" role="radiogroup" aria-label="Colour"></div>'
        + '<label class="another"><input type="color">Another colour</label>'
        + '<p class="preview">“Do not you want to know <mark>who has taken it?</mark>” cried his wife, impatiently.</p>'
        + '<div class="sheet-buttons"><button type="button" class="cancel">Cancel</button><button type="button" class="save"></button></div></div>'
    const title = sheet.querySelector('h2')!
    const name = sheet.querySelector<HTMLInputElement>('input[type="text"]')!
    const another = sheet.querySelector<HTMLInputElement>('input[type="color"]')!
    const preview = sheet.querySelector('mark')!
    const save = sheet.querySelector<HTMLButtonElement>('.save')!
    const swatches = SWATCHES.map(({ solid, name: swatchName }) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.setAttribute('role', 'radio')
        button.setAttribute('aria-label', swatchName)
        button.dataset.solid = solid
        button.innerHTML = '<span class="dot"></span>'
        button.querySelector<HTMLElement>('.dot')!.style.background = solid
        button.addEventListener('click', () => choose(solid))
        sheet.querySelector('.swatches')!.append(button)
        return button
    })
    backdrop.hidden = true
    sheet.hidden = true
    root.append(backdrop, sheet)

    let editing: Highlighter | null = null
    let colour = ''
    let finished: ((id: string | null) => void) | undefined
    const choose = (solid: string): void => {
        colour = solid.toLowerCase()
        for (const button of swatches) button.setAttribute('aria-checked', String(button.dataset.solid === colour))
        another.value = colour
        preview.style.background = highlightFill({ solid: colour, fill: editing?.fill ?? 0.5 })
    }
    another.addEventListener('input', () => choose(another.value))
    const close = (id: string | null): void => {
        sheet.hidden = true
        backdrop.hidden = true
        const done = finished
        finished = undefined
        done?.(id)
    }
    save.addEventListener('click', () => {
        const list = highlighters.list()
        const before = new Set(list.map(highlighter => highlighter.id))
        const entry = { name: highlighterName(name.value, colour), colour }
        const edits: HighlighterEdit[] = list.map(({ id, name: kept, solid }) => id === editing?.id ? { id, ...entry } : { id, name: kept, colour: solid })
        if (!editing) edits.push(entry)
        const target = editing?.id
        void highlighters.save(edits).then(saved => {
            close(saved ? target ?? saved.find(highlighter => !before.has(highlighter.id))?.id ?? null : null)
        })
    })
    for (const dismiss of [sheet.querySelector('.cancel')!, sheet.querySelector('.panel-header button')!, backdrop]) {
        dismiss.addEventListener('click', () => close(null))
    }
    // Escape closes this sheet only, not the panel or toolbar under it.
    window.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || sheet.hidden) return
        event.preventDefault()
        event.stopImmediatePropagation()
        close(null)
    }, { capture: true })

    return {
        open(toEdit, done) {
            editing = toEdit
            finished = done
            const label = toEdit ? 'Edit highlighter' : 'New highlighter'
            title.textContent = label
            sheet.setAttribute('aria-label', label)
            save.textContent = toEdit ? 'Save' : 'Add highlighter'
            name.value = toEdit?.name ?? ''
            choose(toEdit?.solid ?? firstUnused(highlighters.list()))
            sheet.hidden = false
            backdrop.hidden = false
            name.focus()
        },
    }
}
