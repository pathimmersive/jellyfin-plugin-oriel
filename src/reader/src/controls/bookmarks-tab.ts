import type { Bookmarks } from './bookmarks'
import type { PanelTab } from './contents-tab'
import { element } from './elements'
import { icon, ICONS } from './icons'

/** The book's bookmarks; `chosen` is called when one is. */
export const createBookmarksTab = (bookmarks: Bookmarks, chosen: () => void): PanelTab => {
    const body = element('div', { class: 'panel-body bookmarks', id: 'bookmarks-list', role: 'tabpanel', 'aria-labelledby': 'tab-bookmarks' })
    return {
        body,
        fill() {
            const rows = bookmarks.rows()
            if (!rows.length) {
                body.replaceChildren(element('div', { class: 'empty' },
                    `${icon(ICONS.bookmarkOff)}<p>No bookmarks in this book yet.</p><p class="hint">Tap the bookmark beside the progress to mark a page.</p>`))
                return
            }
            const list = element('ul')
            for (const row of rows) {
                const item = element('li')
                const entry = element('a', { href: '#', class: 'entry' }, '<span class="text"></span><span class="where"></span>')
                entry.querySelector('.text')!.textContent = row.text
                entry.querySelector('.where')!.textContent = row.where
                entry.addEventListener('click', event => {
                    event.preventDefault()
                    chosen()
                    void bookmarks.go(row.id)
                })
                const remove = element('button', { type: 'button', class: 'icon-button', 'aria-label': 'Remove this bookmark' }, icon(ICONS.trash))
                remove.addEventListener('click', () => { void bookmarks.remove(row.id) })
                item.append(entry, remove)
                list.append(item)
            }
            body.replaceChildren(list)
        },
    }
}
