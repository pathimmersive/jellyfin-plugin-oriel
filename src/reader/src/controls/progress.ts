import type { Progress } from '../settings/settings'

/**
 * A book counted for one layout: each section's pages, in reading order, and
 * the page each contents link starts on. A page is one column of text.
 */
export interface PageCount {
    sections: number[]
    entries: Record<string, number>
}

/** Where the reader is in pages: the section shown, its first and last pages on screen (from 0) and the pages left in the chapter. */
export interface PagesShown {
    section: number
    first: number
    last: number
    left: number
}

/** What a footer shows for progress: its text, and whether the book is still being counted. */
export interface ProgressShown {
    text: string
    counting: boolean
}

export const percent = (fraction: number): string => `${Math.round(Math.min(Math.max(fraction, 0), 1) * 100)}%`

export const pagesLeftName = (left: number): string =>
    left === 1 ? '1 page left in this chapter' : `${left} pages left in this chapter`

export const totalPages = (count: PageCount): number => count.sections.reduce((sum, pages) => sum + pages, 0)

/** The page number of a section's page (from 0), counting from 1 through the whole book. */
export const pageNumber = (count: PageCount, section: number, page: number): number =>
    totalPages({ sections: count.sections.slice(0, section), entries: {} }) + page + 1

/**
 * The footer's progress: the percent read, or in Pages mode page / total
 * once the book is counted and "Counting pages" with the percent until then.
 * Books without pages (comics, PDFs; `shown` null) always show the percent.
 */
export const progressShown = (mode: Progress, fraction: number, count: PageCount | null, shown: PagesShown | null): ProgressShown => {
    if (mode === 'percent' || !shown) return { text: percent(fraction), counting: false }
    if (!count || shown.section >= count.sections.length) return { text: percent(fraction), counting: true }
    return { text: `${pageNumber(count, shown.section, shown.first)}/${totalPages(count)}`, counting: false }
}

/** A short, stable name for a layout: the same stylesheet and page size give the same key. */
export const layoutKey = (layout: string): string => {
    // FNV-1a, 32-bit.
    let hash = 0x811c9dc5
    for (let i = 0; i < layout.length; i++) {
        hash ^= layout.charCodeAt(i)
        hash = Math.imul(hash, 0x01000193)
    }
    return (hash >>> 0).toString(36)
}

const KEY = 'oriel-page-counts'
/** Counts are kept for this many books, the most recently counted. */
const BOOKS = 20

interface Kept {
    book: string
    layout: string
    count: PageCount
}

const isCount = (value: unknown): value is PageCount => {
    const count = value as Partial<PageCount> | null
    return !!count && Array.isArray(count.sections) && count.sections.every(pages => Number.isInteger(pages) && pages >= 0)
        && !!count.entries && typeof count.entries === 'object'
        && Object.values(count.entries).every(page => Number.isInteger(page) && page >= 1)
}

const readKept = (storage: Pick<Storage, 'getItem'>): Kept[] => {
    try {
        const kept: unknown = JSON.parse(storage.getItem(KEY) ?? '[]')
        return Array.isArray(kept)
            ? kept.filter((entry: Partial<Kept>) => typeof entry?.book === 'string' && typeof entry.layout === 'string' && isCount(entry.count)) as Kept[]
            : []
    } catch {
        return []
    }
}

/** The count kept for `book` laid out as `layout`, or null. */
export const readCount = (storage: Pick<Storage, 'getItem'>, book: string, layout: string): PageCount | null =>
    readKept(storage).find(entry => entry.book === book && entry.layout === layout)?.count ?? null

/** Keeps `count` for `book` laid out as `layout`, in place of any earlier count for the book. */
export const writeCount = (storage: Pick<Storage, 'getItem' | 'setItem'>, book: string, layout: string, count: PageCount): void => {
    const kept = [{ book, layout, count }, ...readKept(storage).filter(entry => entry.book !== book)].slice(0, BOOKS)
    try {
        storage.setItem(KEY, JSON.stringify(kept))
    } catch {
        // A full store: the count lasts for this visit.
    }
}
