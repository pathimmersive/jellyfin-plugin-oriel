import type { WordLookup } from '../api/client'

/** The most words Define looks up together, and the most characters the server takes. */
export const DEFINE_WORDS = 3
export const DEFINE_LENGTH = 64

/** True for text Define can look up: one to three words, at most 64 characters. */
export const definable = (text: string): boolean => {
    const trimmed = text.trim()
    return trimmed.length > 0 && trimmed.length <= DEFINE_LENGTH && trimmed.split(/\s+/).length <= DEFINE_WORDS
}

/** The Dictionary sheet. */
export interface DictionarySheet {
    /** Opens the sheet and looks `text` up. */
    open(text: string): void
    /** Closes the sheet on Escape in another window: a section of the book. */
    watch(win: Pick<Window, 'addEventListener'>): void
}

/** What the Dictionary sheet needs from the page. */
export interface DictionarySources {
    lookUp(word: string): Promise<WordLookup>
    /** Opens Search in this book with a query; null for a book without search. */
    search: ((query: string) => void) | null
    copy(text: string): void
}

const CLOSE = 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'
const SEARCH = 'M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z'
const COPY = 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z'

const svg = (path: string, size: number): string =>
    `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor"><path d="${path}"/></svg>`

/**
 * The Dictionary sheet, as the canvas's PhoneDefine draws it: the word in the
 * book's serif, each part of speech in italics with its senses numbered, where
 * the definitions come from, and Search in this book and Copy, which act on the
 * word. A word the dictionary does not hold says so. Escape, Close or a tap
 * beside it close it.
 */
export const createDictionarySheet = (root: HTMLElement, sources: DictionarySources): DictionarySheet => {
    const backdrop = document.createElement('div')
    backdrop.id = 'dictionary-backdrop'
    backdrop.dataset.controls = ''
    const sheet = document.createElement('section')
    sheet.id = 'dictionary'
    sheet.dataset.controls = ''
    sheet.setAttribute('aria-label', 'Dictionary')
    sheet.tabIndex = -1
    sheet.innerHTML = `<div class="panel-header"><h2>Dictionary</h2><button type="button" class="icon-button" aria-label="Close">${svg(CLOSE, 24)}</button></div>`
        + '<div class="panel-body"><p class="word" lang="en"></p><div class="entries"></div><p class="status" role="status"></p>'
        + '<p class="source">From the English dictionary on your server · works offline</p>'
        + `<div class="sheet-buttons"><button type="button" class="search">${svg(SEARCH, 18)}Search in this book</button><button type="button" class="copy">${svg(COPY, 18)}Copy</button></div></div>`
    const word = sheet.querySelector<HTMLElement>('.word')!
    const entries = sheet.querySelector<HTMLElement>('.entries')!
    const status = sheet.querySelector<HTMLElement>('.status')!
    const search = sheet.querySelector<HTMLButtonElement>('.search')!
    backdrop.hidden = true
    sheet.hidden = true
    root.append(backdrop, sheet)

    // The word the sheet is for, and which lookup is the latest.
    let shown = ''
    let asked = 0
    const close = (): void => {
        asked++
        sheet.hidden = true
        backdrop.hidden = true
    }
    const fill = (text: string, lookup: WordLookup): void => {
        if ('found' in lookup) {
            const { found } = lookup
            shown = found.word
            word.textContent = found.word
            entries.replaceChildren(...found.entries.map(entry => {
                const part = document.createElement('section')
                const name = document.createElement('p')
                name.className = 'part'
                name.textContent = entry.word === found.word ? entry.partOfSpeech : `${entry.partOfSpeech} · ${entry.word}`
                const senses = document.createElement('ol')
                senses.append(...entry.senses.map(sense => {
                    const item = document.createElement('li')
                    item.textContent = sense
                    return item
                }))
                part.append(name, senses)
                return part
            }))
            status.textContent = ''
        } else {
            status.textContent = 'missing' in lookup
                ? `No definition for ${text} in the dictionary on your server.`
                : 'The dictionary on your server could not be reached.'
        }
    }
    const open = (selected: string): void => {
        const text = selected.trim().replace(/\s+/g, ' ')
        const lookup = ++asked
        shown = text
        word.textContent = text
        entries.replaceChildren()
        status.textContent = 'Looking up…'
        search.hidden = !sources.search
        sheet.hidden = false
        backdrop.hidden = false
        sheet.focus()
        void sources.lookUp(text).then(result => {
            if (lookup === asked) fill(text, result)
        })
    }
    search.addEventListener('click', () => {
        const query = shown
        close()
        sources.search?.(query)
    })
    sheet.querySelector('.copy')!.addEventListener('click', () => sources.copy(shown))
    for (const dismiss of [sheet.querySelector('.panel-header button')!, backdrop]) {
        dismiss.addEventListener('click', close)
    }
    const watch = (win: Pick<Window, 'addEventListener'>): void => win.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !sheet.hidden) close()
    })
    watch(window)
    return { open, watch }
}
