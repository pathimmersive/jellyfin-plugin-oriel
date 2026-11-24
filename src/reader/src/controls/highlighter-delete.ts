import { element } from './elements'
import { without } from './highlighter-order'
import type { Highlighters } from './highlighters'
import type { Highlights } from './highlights'

/** The dialog deleting a highlighter asks in. */
export interface HighlighterDelete {
    /** The dialog, over everything. */
    dialog: HTMLElement
    readonly shown: boolean
    close(): void
    /** Asks whether to delete the highlighter `id`, saying how many highlights use it. */
    ask(id: string): Promise<void>
}

export const createHighlighterDelete = (highlighters: Highlighters | null, highlights: Highlights | null): HighlighterDelete => {
    const dialog = element('div', { id: 'highlighter-dialog', class: 'dialog-layer', 'data-controls': '' })
    const box = element('div', { role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'highlighter-dialog-title', 'aria-describedby': 'highlighter-dialog-body' },
        '<h2 id="highlighter-dialog-title"></h2><p id="highlighter-dialog-body"></p><div class="dialog-buttons"></div>')
    const keep = element('button', { type: 'button', class: 'cancel' }, 'Cancel')
    const remove = element('button', { type: 'button', class: 'confirm danger' }, 'Delete')
    box.querySelector('.dialog-buttons')!.append(keep, remove)
    dialog.append(box)
    dialog.hidden = true
    let deleting: string | null = null
    const close = (): void => {
        dialog.hidden = true
        deleting = null
    }
    keep.addEventListener('click', close)
    dialog.addEventListener('click', event => {
        if (event.target === dialog) close()
    })
    remove.addEventListener('click', () => {
        const id = deleting
        close()
        if (!highlighters || !id) return
        // Its highlights become Quotes highlights on the server; read this book's again.
        void highlighters.save(without(highlighters.list(), id)).then(saved => { if (saved) void highlights?.reload() })
    })
    return {
        dialog,
        get shown() {
            return !dialog.hidden
        },
        close,
        async ask(id) {
            if (!highlighters) return
            await highlighters.refresh()
            const { name, uses } = highlighters.find(id)
            box.querySelector('h2')!.textContent = `Delete the ${name} highlighter?`
            box.querySelector('p')!.textContent = uses === 0 ? 'No highlights use it.'
                : uses === 1 ? '1 highlight uses it. It will become a Quotes highlight, so nothing you marked is lost.'
                    : `${uses} highlights use it. They will become Quotes highlights, so nothing you marked is lost.`
            deleting = id
            dialog.hidden = false
            keep.focus()
        },
    }
}
