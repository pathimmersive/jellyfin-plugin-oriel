import { addBookmark, addHighlight, lookUpWord, readBookmarks, readHighlighters, readHighlights, removeBookmark, removeHighlight, saveHighlighters, updateHighlight } from '../api/client'
import { type Bookmarks, createBookmarks } from '../controls/bookmarks'
import { createDictionarySheet, type DictionarySheet } from '../controls/dictionary'
import { NOTICE_TEXT } from '../controls/failure'
import { createHighlighterSheet, type HighlighterSheet } from '../controls/highlighter-sheet'
import { createHighlighters, type Highlighters } from '../controls/highlighters'
import { createHighlights, type Highlights } from '../controls/highlights'
import { createCopy, createHighlighting, type Highlighting } from '../controls/toolbar'
import type { OpenBook } from '../engine/engine'
import { showBriefly } from './notices'
import type { ReaderServer } from './server'

/** What a book with text has beside its bookmarks. */
export interface TextMarks {
    highlights: Highlights
    highlighters: Highlighters
    highlighterSheet: HighlighterSheet
    highlighting: Highlighting
    dictionary: DictionarySheet
}

/** What highlighting needs from the page. */
export interface TextMarksOptions {
    /** The page a highlight is on, or null while that is not known. */
    pageOf(cfi: string): number | null
    /** Opens Search in this book with a query. */
    search(query: string): void
    /** The translation address; empty when Translate is off. */
    translateUrl: string
    wide(): boolean
    touch(): boolean
}

/**
 * Highlights, in a book with text: drawn on the page, made and changed from
 * the Selected text toolbar, and listed in the Contents panel; with the
 * reader's highlighters, kept on the server, and Define's sheet. Null for a
 * book without text.
 */
export const createTextMarks = (opened: OpenBook, { basePath, itemId, authorization, fetch }: ReaderServer, options: TextMarksOptions): TextMarks | null => {
    if (opened.fixedLayout) return null
    const highlights = createHighlights({
        load: () => readHighlights(basePath, itemId, authorization, fetch),
        add: async (cfi, fraction, colour, text, note) => {
            const added = await addHighlight(basePath, itemId, authorization, cfi, fraction, colour, text, note, fetch)
            if (added === 'limitReached') showBriefly(NOTICE_TEXT.highlightsFull)
            else if (!added) showBriefly(NOTICE_TEXT.highlightNotSaved)
            return added
        },
        update: async (id, change) => {
            const changed = await updateHighlight(basePath, itemId, authorization, id, change, fetch)
            if (!changed) showBriefly(NOTICE_TEXT.highlightNotSaved)
            return changed
        },
        remove: async id => {
            const removed = await removeHighlight(basePath, itemId, authorization, id, fetch)
            if (!removed) showBriefly(NOTICE_TEXT.highlightNotRemoved)
            return removed
        },
        compare: (a, b) => opened.compare(a, b),
        chapterOf: cfi => opened.chapterOf(cfi),
        pageOf: cfi => options.pageOf(cfi),
        go: cfi => opened.goTo(cfi),
    })
    const highlighters = createHighlighters({
        load: () => readHighlighters(basePath, authorization, fetch),
        save: list => saveHighlighters(basePath, authorization, list, fetch),
    })
    const highlighterSheet = createHighlighterSheet(document.body, highlighters)
    const search = opened.searchable ? (query: string) => options.search(query) : null
    const copy = createCopy(document.body)
    const dictionary = createDictionarySheet(document.body, {
        lookUp: word => lookUpWord(basePath, authorization, word, fetch),
        search,
        copy,
    })
    const highlighting = createHighlighting(document.body, opened, highlights, highlighters, highlighterSheet, () => options.wide(), {
        title: opened.title,
        translateUrl: () => options.translateUrl,
        search,
        copy,
        define: text => dictionary.open(text),
    }, () => options.touch())
    return { highlights, highlighters, highlighterSheet, highlighting, dictionary }
}

/** The book's bookmarks; `pageOf` gives the page one is on, or null while that is not known. */
export const createBookBookmarks = (opened: OpenBook, { basePath, itemId, authorization, fetch }: ReaderServer, pageOf: (cfi: string) => number | null): Bookmarks =>
    createBookmarks({
        load: () => readBookmarks(basePath, itemId, authorization, fetch),
        add: async (cfi, fraction, text) => {
            const added = await addBookmark(basePath, itemId, authorization, cfi, fraction, text, fetch)
            if (added && added !== 'limitReached') return added
            showBriefly(added ? NOTICE_TEXT.bookmarksFull : NOTICE_TEXT.bookmarkNotSaved)
            return null
        },
        remove: async id => {
            const removed = await removeBookmark(basePath, itemId, authorization, id, fetch)
            if (!removed) showBriefly(NOTICE_TEXT.bookmarkNotRemoved)
            return removed
        },
        page: () => opened.page(),
        fromPage: cfi => opened.fromPage(cfi),
        compare: (a, b) => opened.compare(a, b),
        chapterOf: cfi => opened.chapterOf(cfi),
        pageOf,
        go: cfi => opened.goTo(cfi),
    })
