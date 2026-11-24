import type { ContentsRow } from './contents'
import { element } from './elements'
import { icon, ICONS } from './icons'

/** What the Contents tab lists, and what choosing an entry does. */
export interface ContentsTabOptions {
    /** The rows, with the entry being read marked. */
    rows(): ContentsRow[]
    /** Goes to an entry's link, as a reader move. */
    choose(href: string): Promise<void>
    /** An entry was chosen. */
    chosen(): void
}

/** A tab of the Contents panel: its body, and what fills it. */
export interface PanelTab {
    body: HTMLElement
    fill(): void
}

/** The book's contents. */
export const createContentsTab = (options: ContentsTabOptions): PanelTab => {
    const body = element('div', { class: 'panel-body', id: 'contents-list', role: 'tabpanel', 'aria-labelledby': 'tab-contents' })
    return {
        body,
        fill() {
            const rows = options.rows()
            if (!rows.length) {
                body.replaceChildren(element('p', { class: 'empty' }, `${icon(ICONS.toc)}<span>This book has no table of contents.</span>`))
                return
            }
            const list = element('ol')
            for (const row of rows) {
                const entry = element(row.href ? 'a' : 'span', { class: 'entry', style: `--depth: ${row.depth}` }, '<span class="label"></span><span class="where"></span>')
                entry.querySelector('.label')!.textContent = row.label
                entry.querySelector('.where')!.textContent = row.where
                if (row.href) {
                    entry.setAttribute('href', '#')
                    entry.addEventListener('click', event => {
                        event.preventDefault()
                        options.chosen()
                        void options.choose(row.href)
                    })
                }
                if (row.current) entry.setAttribute('aria-current', 'true')
                const item = element('li')
                item.append(entry)
                list.append(item)
            }
            body.replaceChildren(list)
        },
    }
}
