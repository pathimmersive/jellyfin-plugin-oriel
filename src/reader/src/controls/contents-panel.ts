import type { Bookmarks } from './bookmarks'
import { createBookmarksTab } from './bookmarks-tab'
import type { ContentsRow } from './contents'
import { createContentsTab } from './contents-tab'
import { closeButton, element } from './elements'
import type { Highlighters } from './highlighters'
import type { Highlights } from './highlights'
import { createHighlightsTab } from './highlights-tab'

export type Tab = 'contents' | 'bookmarks' | 'highlights'

/** What the Contents panel lists, and what choosing an entry does. */
export interface ContentsPanelOptions {
    /** The book's title. */
    title: string
    /** The Contents tab's rows, with the entry being read marked. */
    contents(): ContentsRow[]
    /** Goes to a contents entry's link, as a reader move. */
    choose(href: string): Promise<void>
    bookmarks: Bookmarks
    /** The book's highlights, for a book with text; null for comics and PDFs. */
    highlights: Highlights | null
    highlighters: Highlighters | null
    /** An entry was chosen, in any tab. */
    chosen(): void
}

/** The Contents panel. */
export interface ContentsPanel {
    backdrop: HTMLElement
    panel: HTMLElement
    close: HTMLButtonElement
    /** Fills the tab shown last and shows the entry being read, with Close focused. */
    opened(): void
    /** Fills the tab shown again; with `tab`, only when it is that one. */
    refill(tab?: Tab): void
}

/**
 * Contents: a sheet over a dimmed page on a phone, a panel beside the page on
 * a wider screen, with a tab for the book's contents, one for its bookmarks
 * and, in a book with text, one for its highlights.
 */
export const createContentsPanel = (options: ContentsPanelOptions): ContentsPanel => {
    const backdrop = element('div', { id: 'contents-backdrop', 'data-controls': '' })
    const panel = element('section', { id: 'contents', 'data-controls': '', 'aria-label': 'Contents' })
    const title = element('h2')
    title.textContent = options.title
    const close = closeButton()
    const header = element('div', { class: 'panel-header' })
    header.append(title, close)
    const contents = createContentsTab({ rows: () => options.contents(), choose: href => options.choose(href), chosen: () => options.chosen() })
    const bookmarks = createBookmarksTab(options.bookmarks, () => options.chosen())
    const highlights = createHighlightsTab(options.highlights, options.highlighters, () => options.chosen())
    const tabList = element('div', { role: 'tablist', class: 'tabs' })
    const choices: { name: Tab, label: string, body: HTMLElement, fill: () => void }[] = [
        { name: 'contents', label: 'Contents', ...contents },
        { name: 'bookmarks', label: 'Bookmarks', ...bookmarks },
    ]
    if (options.highlights) choices.push({ name: 'highlights', label: 'Highlights', ...highlights })
    const tabs = choices.map(({ name, label, body, fill }) => {
        const tab = element('button', { type: 'button', role: 'tab', id: `tab-${name}`, 'aria-controls': body.id, 'aria-selected': 'false' })
        tab.textContent = label
        tab.addEventListener('click', () => chooseTab(name))
        tabList.append(tab)
        return { name, tab, body, fill }
    })
    let tabShown: Tab = 'contents'
    panel.append(header, tabList, ...tabs.map(({ body }) => body))
    const fillShown = (): void => tabs.find(({ name }) => name === tabShown)?.fill()
    // The tab shown last stays shown; only its list is filled.
    const chooseTab = (name: Tab): void => {
        tabShown = name
        for (const { name: each, tab, body } of tabs) {
            tab.setAttribute('aria-selected', String(each === name))
            body.hidden = each !== name
            if (each !== name) body.replaceChildren()
        }
        fillShown()
        if (name === 'contents') contents.body.querySelector('[aria-current]')?.scrollIntoView({ block: 'center' })
    }
    return {
        backdrop,
        panel,
        close,
        opened() {
            chooseTab(tabShown)
            close.focus()
        },
        refill(tab) {
            if (tab === undefined || tab === tabShown) fillShown()
        },
    }
}
