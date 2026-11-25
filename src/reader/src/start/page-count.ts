import { layoutKey, type PageCount, pageNumber } from '../controls/progress'
import type { OpenBook } from '../engine/engine'

/** What counting the pages needs: the book, what is marked in it, and where counts are kept. */
export interface PageCountSources {
    book: Pick<OpenBook, 'fixedLayout' | 'layout' | 'count' | 'pageShown'>
    /** Whether Progress shows pages. */
    pages(): boolean
    /** Whether the book is laid out beside a panel. */
    beside(): boolean
    /** Where the bookmarks and highlights are (their CFIs). */
    marked(): string[]
    /** The count kept from before for a layout, or null. */
    read(layout: string): PageCount | null
    /** Keeps a layout's count, marks placed and all, so it is not done for each one placed. */
    write(layout: string, count: PageCount): void
    /** The count changed, or may have: what shows pages shows them again. */
    changed(): void
}

/** The book's page count for its layout. */
export interface BookPages {
    /** The count for the layout shown, or null while there is none. */
    count(): PageCount | null
    /**
     * Counts the book for its layout unless it is counted or being counted.
     * `force` counts again for places the count has not tried, keeping the
     * count shown until the new one lands.
     */
    recount(force?: boolean): void
    /** The page a bookmark or highlight is on, or null while that is not known. */
    pageOf(cfi: string): number | null
    /** Counts again for bookmarks and highlights the count has not placed: ones loaded after it, or added on another device. */
    placeMarked(): void
    /** Keeps the places found since the count was last kept, now, as when the page is hidden. */
    flush(): void
}

// How long the places found are gathered before they are kept, in one write.
const KEEP_MS = 1000

/**
 * Pages mode counts the book for its layout, in the background; a count kept
 * from before for the same layout is used at once. The count places the
 * bookmarks and highlights too. While the book is laid out beside a panel,
 * the count stays that of its layout without it.
 */
export const createPageCount = (sources: PageCountSources): BookPages => {
    const { book } = sources
    let count: PageCount | null = null
    let counting: { cancelled: boolean } | null = null
    let countedFor = ''
    const tried = new Set<string>()
    // Set while places found since the count was last kept wait to be.
    let keeping: ReturnType<typeof setTimeout> | undefined
    const kept = (): void => {
        clearTimeout(keeping)
        keeping = undefined
    }
    const flush = (): void => {
        if (keeping === undefined) return
        kept()
        if (count) sources.write(countedFor, count)
    }
    const placeMarked = (): void => {
        if (!count || counting) return
        const counted = count
        if (sources.marked().some(cfi => !counted.entries[cfi] && !tried.has(cfi) && !book.pageShown(cfi))) recount(true)
    }
    const recount = (force = false): void => {
        if (sources.beside()) return
        const key = sources.pages() && !book.fixedLayout ? layoutKey(book.layout()) : ''
        if (!force && key === countedFor && (count || counting)) return
        flush()
        if (counting) counting.cancelled = true
        counting = null
        if (!force || key !== countedFor) count = null
        countedFor = key
        if (key) {
            count ??= force ? null : sources.read(key)
            if (!count || force) {
                const places = sources.marked()
                const run = { cancelled: false }
                counting = run
                void book.count(() => run.cancelled, places).then(result => {
                    if (run.cancelled || !result) return
                    counting = null
                    count = result
                    for (const cfi of places) tried.add(cfi)
                    kept()
                    sources.write(key, result)
                    sources.changed()
                    placeMarked()
                }).catch(error => console.error('counting pages', error))
            } else {
                placeMarked()
            }
        }
        sources.changed()
    }
    return {
        count: () => count,
        recount,
        // From the count, or, for one made since on the section shown, from the layout on screen.
        pageOf(cfi) {
            if (!sources.pages() || !count) return null
            const counted = count.entries[cfi]
            if (counted) return counted
            if (sources.beside()) return null
            const here = book.pageShown(cfi)
            if (!here || here.section >= count.sections.length) return null
            count.entries[cfi] = pageNumber(count, here.section, here.page)
            keeping ??= setTimeout(flush, KEEP_MS)
            return count.entries[cfi]
        },
        placeMarked,
        flush,
    }
}
