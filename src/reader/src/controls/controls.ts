import type { ContentsRow } from './contents'
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
    /** The Contents panel's rows, with the entry being read marked. */
    contents(): ContentsRow[]
    /** Goes to a contents entry's link, as a reader move. */
    choose(href: string): Promise<void>
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
    toc: 'M3 9h14V7H3v2zm0 4h14v-2H3v2zm0 4h14v-2H3v2zm16 0h2v-2h-2v2zm0-10v2h2V7h-2zm0 6h2v-2h-2v2z',
    close: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
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
    const contentsButton = element('button', { type: 'button', class: 'icon-button', 'aria-label': 'Contents', 'aria-expanded': 'false', 'aria-controls': 'contents' }, icon(ICONS.toc))
    const moreButton = element('button', { type: 'button', class: 'icon-button', 'aria-label': 'More', 'aria-haspopup': 'true', 'aria-expanded': 'false', 'aria-controls': 'more' }, icon(ICONS.more))
    const header = element('header')
    header.append(back, title, contentsButton, moreButton)

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

    // Contents: a sheet over a dimmed page on a phone, a panel beside the page on a wider screen.
    const contentsBackdrop = element('div', { id: 'contents-backdrop', 'data-controls': '' })
    const contents = element('section', { id: 'contents', 'data-controls': '', 'aria-label': 'Contents' })
    const contentsTitle = element('h2')
    contentsTitle.textContent = options.title
    const close = element('button', { type: 'button', class: 'icon-button', 'aria-label': 'Close' }, icon(ICONS.close))
    const contentsHeader = element('div', { class: 'panel-header' })
    contentsHeader.append(contentsTitle, close)
    const contentsBody = element('div', { class: 'panel-body' })
    contents.append(contentsHeader, contentsBody)
    const fillContents = (): void => {
        const rows = options.contents()
        if (!rows.length) {
            contentsBody.replaceChildren(element('p', { class: 'empty' }, `${icon(ICONS.toc)}<span>This book has no table of contents.</span>`))
            return
        }
        const list = element('ol')
        for (const row of rows) {
            const entry = element(row.href ? 'a' : 'span', { class: 'entry', style: `--depth: ${row.depth}` }, '<span class="label"></span><span class="where"></span>')
            entry.querySelector('.label')!.textContent = row.label
            entry.querySelector('.where')!.textContent = row.percent
            if (row.href) {
                entry.setAttribute('href', '#')
                entry.addEventListener('click', event => {
                    event.preventDefault()
                    apply('chosen')
                    void options.choose(row.href)
                })
            }
            if (row.current) entry.setAttribute('aria-current', 'true')
            const item = element('li')
            item.append(entry)
            list.append(item)
        }
        contentsBody.replaceChildren(list)
    }

    root.append(reading.row, bar, backdrop, more, contentsBackdrop, contents)

    let state: ControlsState = HIDDEN
    const show = (): void => {
        bar.hidden = !state.shown
        reading.row.hidden = state.shown
        more.hidden = !state.more
        backdrop.hidden = !state.more
        moreButton.setAttribute('aria-expanded', String(state.more))
        contents.hidden = !state.contents
        contentsBackdrop.hidden = !state.contents
        contentsButton.setAttribute('aria-expanded', String(state.contents))
    }
    const apply = (event: ControlsEvent): void => {
        const opening = event === 'contents' && !state.contents
        state = nextControls(state, event)
        show()
        if (opening) {
            // Fill on opening, so the entry being read is the one marked, and show it.
            fillContents()
            contentsBody.querySelector('[aria-current]')?.scrollIntoView({ block: 'center' })
            close.focus()
        }
    }
    show()

    moreButton.addEventListener('click', () => apply('more'))
    backdrop.addEventListener('click', () => apply('outside'))
    contentsButton.addEventListener('click', () => apply('contents'))
    contentsBackdrop.addEventListener('click', () => apply('outside'))
    close.addEventListener('click', () => apply('outside'))
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && (state.more || state.contents)) apply('outside')
    })

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
