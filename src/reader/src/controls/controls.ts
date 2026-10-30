import { type ControlsEvent, type ControlsState, HIDDEN, nextControls } from './state'

/** What the controls show and where their links go. */
export interface ControlsOptions {
    /** The book's title, for the header. */
    title: string
    /** The book's details page in jellyfin-web. */
    detailsUrl: string
    /** Your reading data for this book. */
    dataUrl: string
    /** Goes to a fraction of the book, as a reader move. */
    seek(fraction: number): Promise<void>
}

/** The reader's controls, as the page drives them. */
export interface Controls {
    /** A tap or click in the middle of the page. */
    middle(): void
    /** A page turned by the reader. */
    turned(): void
    /** The place now shown: its chapter's name (empty for none) and the fraction of the book. */
    locate(chapter: string, fraction: number): void
}

// Material icons, as the canvas draws them.
const ICONS = {
    back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
    more: 'M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
    data: 'M9 3L5 6.99h3V14h2V6.99h3L9 3zm7 14.01V10h-2v7.01h-3L15 21l4-3.99h-3z',
    info: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z',
}

const icon = (path: string): string =>
    `<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="${path}"/></svg>`

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Record<string, string> = {}, html = ''): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag)
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value)
    node.innerHTML = html
    return node
}

const percent = (fraction: number): string => `${Math.round(Math.min(Math.max(fraction, 0), 1) * 100)}%`

// The chapter and the percent read, as both footers show them.
const placeRow = (): { row: HTMLElement, chapter: HTMLElement, progress: HTMLElement } => {
    const row = element('div', { class: 'place' })
    const chapter = element('span', { class: 'chapter' })
    const progress = element('span', { class: 'progress' })
    row.append(chapter, progress)
    return { row, chapter, progress }
}

/**
 * Adds the reader's controls to `root`: a reading footer shown while reading,
 * and the header, footer and More shown by a tap in the middle of the page.
 */
export const createControls = (root: HTMLElement, options: ControlsOptions): Controls => {
    const reading = placeRow()
    reading.row.id = 'reading-footer'

    const back = element('a', { class: 'icon-button', href: options.detailsUrl, 'aria-label': 'Back to the book in Jellyfin' }, icon(ICONS.back))
    const title = element('span', { class: 'title' })
    title.textContent = options.title
    const moreButton = element('button', { type: 'button', class: 'icon-button', 'aria-label': 'More', 'aria-haspopup': 'true', 'aria-expanded': 'false', 'aria-controls': 'more' }, icon(ICONS.more))
    const header = element('header')
    header.append(back, title, moreButton)

    const place = placeRow()
    const slider = element('input', { type: 'range', min: '0', max: '100', step: 'any', value: '0', 'aria-label': 'Position in the book' })
    const footer = element('footer')
    footer.append(place.row, slider)

    const bar = element('div', { id: 'controls', 'data-controls': '' })
    bar.append(header, footer)

    const backdrop = element('div', { id: 'more-backdrop', 'data-controls': '' })
    const more = element('nav', { id: 'more', 'data-controls': '', 'aria-label': 'More' })
    const link = (href: string, path: string, name: string): HTMLAnchorElement => {
        const a = element('a', { href }, `${icon(path)}<span></span>`)
        a.querySelector('span')!.textContent = name
        return a
    }
    more.append(link(options.dataUrl, ICONS.data, 'Your reading data'), link(options.detailsUrl, ICONS.info, 'Book details in Jellyfin'))

    root.append(reading.row, bar, backdrop, more)

    let state: ControlsState = HIDDEN
    const show = (): void => {
        bar.hidden = !state.shown
        reading.row.hidden = state.shown
        more.hidden = !state.more
        backdrop.hidden = !state.more
        moreButton.setAttribute('aria-expanded', String(state.more))
    }
    const apply = (event: ControlsEvent): void => {
        state = nextControls(state, event)
        show()
    }
    show()

    moreButton.addEventListener('click', () => apply('more'))
    backdrop.addEventListener('click', () => apply('outside'))

    // The percent follows the slider while it moves; the book moves on release.
    slider.addEventListener('input', () => { place.progress.textContent = percent(Number(slider.value) / 100) })
    slider.addEventListener('change', () => { void options.seek(Number(slider.value) / 100) })

    return {
        middle: () => apply('middle'),
        turned: () => apply('turned'),
        locate(chapter, fraction) {
            for (const row of [reading, place]) {
                row.chapter.textContent = chapter
                row.progress.textContent = percent(fraction)
            }
            slider.value = String(fraction * 100)
        },
    }
}
