import { closeButton, element } from './elements'
import { icon, ICONS } from './icons'
import { type BookSearch, noMatches } from './search'

/** The Search in this book panel. */
export interface SearchPanel {
    backdrop: HTMLElement
    panel: HTMLElement
    close: HTMLButtonElement
    /** Focuses the search field. */
    focus(): void
    /** Puts a query in the field and searches for it at once. */
    search(query: string): void
}

/**
 * Search in this book: a sheet or panel like Contents. A search lists each
 * chapter's matches as it is searched, and choosing one, which calls `chosen`,
 * goes there. `search` is null for a book without text to search.
 */
export const createSearchPanel = (search: BookSearch | null, chosen: () => void): SearchPanel => {
    const backdrop = element('div', { id: 'search-backdrop', 'data-controls': '' })
    const panel = element('section', { id: 'search', 'data-controls': '', 'aria-label': 'Search in this book' })
    const close = closeButton()
    const header = element('div', { class: 'panel-header' }, '<h2>Search in this book</h2>')
    header.append(close)
    const form = element('form', { role: 'search', class: 'search-form' },
        `<label class="field">${icon(ICONS.search)}<span class="visually-hidden">Search in this book</span><input type="search" enterkeyhint="search" autocomplete="off" spellcheck="false"></label>`)
    const field = form.querySelector('input')!
    const results = element('div', { class: 'results' })
    const searching = element('p', { class: 'searching', role: 'status' })
    searching.textContent = 'Searching the rest of the book…'
    searching.hidden = true
    const body = element('div', { class: 'panel-body' })
    body.append(form, results, searching)
    panel.append(header, body)
    // Each search has its number; an older one still running stops at its next section.
    let searchRun = 0
    const clear = (): void => {
        searchRun++
        results.replaceChildren()
        searching.hidden = true
        search?.clear()
    }
    const matchItem = (cfi: string, pre: string, match: string, post: string): HTMLLIElement => {
        const item = element('li')
        const go = element('a', { href: '#' }, '<span></span><mark></mark><span></span>')
        const [before, marked, after] = go.children
        before.textContent = pre
        marked.textContent = match
        after.textContent = post
        go.addEventListener('click', event => {
            event.preventDefault()
            chosen()
            void search?.go(cfi)
        })
        item.append(go)
        return item
    }
    const runSearch = async (query: string): Promise<void> => {
        if (!search) return
        const run = ++searchRun
        results.replaceChildren()
        searching.hidden = false
        let chapter = ''
        let list: HTMLUListElement | null = null
        let found = false
        try {
            for await (const section of search.run(query)) {
                if (run !== searchRun) return
                if (!section.matches.length) continue
                found = true
                // A chapter can span sections: its matches stay under one name.
                if (!list || section.label !== chapter) {
                    chapter = section.label
                    const group = element('div', { class: 'group' })
                    if (chapter) {
                        const name = element('span', { class: 'chapter' })
                        name.textContent = chapter
                        group.append(name)
                    }
                    list = element('ul')
                    group.append(list)
                    results.append(group)
                }
                for (const { cfi, pre, match, post } of section.matches) list.append(matchItem(cfi, pre, match, post))
            }
        } catch (error) {
            console.warn('Oriel: the search stopped', error)
        }
        if (run !== searchRun) return
        searching.hidden = true
        if (!found) {
            const none = element('div', { class: 'no-matches' }, `${icon(ICONS.search)}<p class="what"></p><p class="next">Check the spelling, or search for fewer words.</p>`)
            none.querySelector('.what')!.textContent = noMatches(query)
            results.replaceChildren(none)
        }
    }
    form.addEventListener('submit', event => {
        event.preventDefault()
        const query = field.value.trim()
        if (query) void runSearch(query)
        else clear()
    })
    field.addEventListener('input', () => {
        if (!field.value) clear()
    })
    return {
        backdrop,
        panel,
        close,
        focus: () => field.focus(),
        search(query) {
            field.value = query
            void runSearch(query)
        },
    }
}
