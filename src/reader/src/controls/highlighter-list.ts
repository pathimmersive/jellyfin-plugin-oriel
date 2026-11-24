import { element } from './elements'
import { dropTarget, keyTarget, reordered } from './highlighter-order'
import type { HighlighterSheet } from './highlighter-sheet'
import { type Highlighters, MAX_HIGHLIGHTERS } from './highlighters'
import { icon, ICONS } from './icons'

/** Preferences' highlighters. */
export interface HighlighterList {
    box: HTMLElement
    /** Fills the list. */
    fill(): void
}

/**
 * Highlighters: each in its order, to move, edit and (the reader's own)
 * delete, which calls `remove`, then Add a highlighter.
 */
export const createHighlighterList = (highlighters: Highlighters | null, sheet: HighlighterSheet | null, remove: (id: string) => void): HighlighterList => {
    const box = element('div', { role: 'group', 'aria-label': 'Highlighters', class: 'highlighter-list' },
        '<span class="group-label"><span>Highlighters</span><span class="count"></span></span><ul></ul>')
    const rows = box.querySelector('ul')!
    const add = element('button', { type: 'button', class: 'add-highlighter' }, `${icon(ICONS.plus)}<span>Add a highlighter</span>`)
    box.append(add)
    add.addEventListener('click', () => sheet?.open(null))
    // Keeps the list in a new order, then puts the focus back on the moved one's handle.
    const reorder = (from: number, to: number): void => {
        if (!highlighters) return
        const list = highlighters.list()
        const edits = reordered(list, from, to)
        if (!edits) return
        const id = list[from].id
        void highlighters.save(edits).then(() => {
            rows.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"] .move`)?.focus()
        })
    }
    // A drag by the handle moves a row where it is dropped.
    const drag = (row: HTMLElement, move: HTMLButtonElement, index: number): void => move.addEventListener('pointerdown', event => {
        event.preventDefault()
        move.setPointerCapture(event.pointerId)
        // The rows stay where they are while the one dragged follows the
        // pointer (moving it in the list would lose the pointer); where it
        // lands is worked out from the others' middles as the drag began.
        const middles = ([...rows.children] as HTMLElement[]).filter(each => each !== row)
            .map(each => each.getBoundingClientRect().top + each.offsetHeight / 2)
        const startY = event.clientY
        let at = index
        row.classList.add('dragging')
        const follow = (moving: PointerEvent): void => {
            row.style.transform = `translateY(${moving.clientY - startY}px)`
            at = dropTarget(middles, moving.clientY)
        }
        const drop = (): void => {
            move.removeEventListener('pointermove', follow)
            move.removeEventListener('pointerup', drop)
            move.removeEventListener('pointercancel', drop)
            row.classList.remove('dragging')
            row.style.transform = ''
            reorder(index, at)
        }
        move.addEventListener('pointermove', follow)
        move.addEventListener('pointerup', drop)
        move.addEventListener('pointercancel', drop)
    })
    const fill = (): void => {
        if (!highlighters) return
        const list = highlighters.list()
        box.querySelector('.count')!.textContent = `${list.length} of ${MAX_HIGHLIGHTERS}`
        add.hidden = list.length >= MAX_HIGHLIGHTERS
        rows.replaceChildren(...list.map((highlighter, index) => {
            const row = element('li', { 'data-id': highlighter.id },
                `<button type="button" class="move">${icon(ICONS.drag)}</button><span class="dot"></span><span class="name"><span></span></span>`)
            const move = row.querySelector<HTMLButtonElement>('.move')!
            move.setAttribute('aria-label', `Move ${highlighter.name}`)
            row.querySelector<HTMLElement>('.dot')!.style.background = highlighter.solid
            row.querySelector('.name span')!.textContent = highlighter.name
            if (highlighter.builtIn) row.querySelector('.name')!.append(element('span', { class: 'default' }, 'Default colour'))
            const edit = element('button', { type: 'button', class: 'icon-button', 'aria-label': `Edit ${highlighter.name}` }, icon(ICONS.edit))
            edit.addEventListener('click', () => sheet?.open(highlighter))
            row.append(edit)
            if (!highlighter.builtIn) {
                const deleteButton = element('button', { type: 'button', class: 'icon-button', 'aria-label': `Delete ${highlighter.name}` }, icon(ICONS.trash))
                deleteButton.addEventListener('click', () => remove(highlighter.id))
                row.append(deleteButton)
            } else {
                row.append(element('span', { class: 'spacer', 'aria-hidden': 'true' }))
            }
            // The arrows move it one place.
            move.addEventListener('keydown', event => {
                const to = keyTarget(event.key, index, list.length)
                if (to === null) return
                event.preventDefault()
                reorder(index, to)
            })
            drag(row, move, index)
            return row
        }))
    }
    return { box, fill }
}
