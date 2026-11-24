import type { PanelTab } from './contents-tab'
import { element } from './elements'
import { highlightFill, type Highlighters } from './highlighters'
import type { Highlights } from './highlights'
import { icon, ICONS } from './icons'

/** The book's highlights of the colour chosen, under chips choosing it; `chosen` is called when one is. */
export const createHighlightsTab = (highlights: Highlights | null, highlighters: Highlighters | null, chosen: () => void): PanelTab => {
    const body = element('div', { class: 'panel-body highlights', id: 'highlights-list', role: 'tabpanel', 'aria-labelledby': 'tab-highlights' })
    // The colour chosen, or null for all.
    let colourShown: string | null = null
    const fill = (): void => {
        if (!highlights || !highlighters) return
        if (colourShown && !highlighters.list().some(highlighter => highlighter.id === colourShown)) colourShown = null
        if (!highlights.rows(null).length) {
            body.replaceChildren(element('div', { class: 'empty' },
                `${icon(ICONS.highlight)}<p>No highlights in this book yet.</p><p class="hint">Select text to highlight it or add a note.</p>`))
            return
        }
        const chips = element('div', { role: 'group', class: 'chips', 'aria-label': 'Show highlights of one colour' })
        for (const [colour, name, solid] of [[null, 'All', ''] as const, ...highlighters.list().map(each => [each.id, each.name, each.solid] as const)]) {
            const chip = element('button', { type: 'button', class: 'chip', 'aria-pressed': String(colour === colourShown) },
                `${solid ? '<span class="dot"></span>' : ''}<span></span>`)
            chip.querySelector<HTMLElement>('.dot')?.style.setProperty('background', solid)
            chip.lastElementChild!.textContent = name
            chip.addEventListener('click', () => {
                colourShown = colour
                fill()
                body.querySelector<HTMLElement>('.chip[aria-pressed="true"]')?.focus()
            })
            chips.append(chip)
        }
        const rows = highlights.rows(colourShown)
        if (!rows.length) {
            const none = element('p', { class: 'none' })
            none.textContent = 'No highlights in this colour.'
            body.replaceChildren(chips, none)
            return
        }
        const list = element('ul')
        for (const row of rows) {
            const item = element('li')
            const entry = element('a', { href: '#', class: 'entry' }, '<span class="text"><mark></mark></span><span class="where"></span>')
            if (row.note) {
                const note = element('span', { class: 'note' }, `${icon(ICONS.note)}<span></span>`)
                note.lastElementChild!.textContent = row.note
                entry.querySelector('.where')!.before(note)
            }
            const mark = entry.querySelector('mark')!
            mark.textContent = row.text
            mark.dataset.colour = row.colour
            mark.style.background = highlightFill(highlighters.find(row.colour))
            entry.querySelector('.where')!.textContent = row.where
            entry.addEventListener('click', event => {
                event.preventDefault()
                chosen()
                void highlights.go(row.id)
            })
            const remove = element('button', { type: 'button', class: 'icon-button', 'aria-label': 'Delete this highlight' }, icon(ICONS.trash))
            remove.addEventListener('click', () => { void highlights.remove(row.id) })
            item.append(entry, remove)
            list.append(item)
        }
        body.replaceChildren(chips, list)
    }
    return { body, fill }
}
