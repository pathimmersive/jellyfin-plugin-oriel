import type { WordLookup } from '../api/client'
import { icon, ICONS } from './icons'

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
    sheet.innerHTML = `<div class="panel-header"><h2>Dictionary</h2><button type="button" class="icon-button" aria-label="Close">${icon(ICONS.close)}</button></div>`
        + '<div class="panel-body"><p class="word" lang="en"></p><div class="entries"></div><p class="status" role="status"></p>'
        + '<p class="source">From the English dictionary on your server · works offline</p>'
        + `<div class="sheet-buttons"><button type="button" class="search">${icon(ICONS.search, 18)}Search in this book</button><button type="button" class="copy">${icon(ICONS.copy, 18)}Copy</button></div></div>`
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
