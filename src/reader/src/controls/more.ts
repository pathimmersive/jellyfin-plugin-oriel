import { element } from './elements'
import { icon, ICONS } from './icons'

/** Where More's links go, and whether it offers Search in this book. */
export interface MoreOptions {
    search: boolean
    /** Your reading data for this book. */
    dataUrl: string
    /** The book's details page in jellyfin-web. */
    detailsUrl: string
    /** Oriel's license and the third-party notices. */
    licensesUrl: string
}

/** The More menu and its buttons. */
export interface More {
    backdrop: HTMLElement
    menu: HTMLElement
    search: HTMLButtonElement
    showGestures: HTMLButtonElement
}

const link = (href: string, path: string, name: string): HTMLAnchorElement => {
    const a = element('a', { href }, `${icon(path)}<span></span>`)
    a.querySelector('span')!.textContent = name
    return a
}

export const createMore = (options: MoreOptions): More => {
    const backdrop = element('div', { id: 'more-backdrop', 'data-controls': '' })
    const menu = element('nav', { id: 'more', 'data-controls': '', 'aria-label': 'More' })
    const showGestures = element('button', { type: 'button' }, `${icon(ICONS.gesture)}<span>Show reading gestures</span>`)
    const search = element('button', { type: 'button' }, `${icon(ICONS.search)}<span>Search in this book</span>`)
    if (options.search) menu.append(search)
    menu.append(link(options.dataUrl, ICONS.data, 'Your reading data'), showGestures, link(options.detailsUrl, ICONS.info, 'Book details in Jellyfin'),
        link(options.licensesUrl, ICONS.licenses, 'Licenses'))
    return { backdrop, menu, search, showGestures }
}
