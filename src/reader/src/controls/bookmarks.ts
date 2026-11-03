import type { Bookmark } from '../api/client'
import { percent } from './progress'

/** The longest text a bookmark keeps, as the server takes it. */
export const BOOKMARK_TEXT = 200

/** Text with its spaces evened, cut at a word to at most `limit` characters, ending in an ellipsis when cut. */
export const cutAtWord = (whole: string, limit: number): string => {
    const text = whole.replace(/\s+/g, ' ').trim()
    if (text.length <= limit) return text
    const cut = text.slice(0, limit - 1)
    const space = cut.lastIndexOf(' ')
    return `${(space > limit / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** The text a bookmark keeps for a page: its opening text, spaces evened, cut at a word to BOOKMARK_TEXT characters. */
export const bookmarkText = (pageText: string): string => cutAtWord(pageText, BOOKMARK_TEXT)

/**
 * Where a bookmark is, as its row shows it: its chapter's name and the
 * percent of the book, or the page it is on when the book is counted.
 */
export const bookmarkWhere = (chapter: string, fraction: number, page: number | null = null): string => {
    const at = page === null ? percent(fraction) : `page ${page}`
    return chapter ? `${chapter} · ${at}` : at
}

/** The page shown, as a bookmark keeps it: where it starts and the text it opens with. */
export interface PageMark {
    cfi: string
    fraction: number
    text: string
}

/** A row of the Bookmarks tab. */
export interface BookmarkRow {
    id: string
    text: string
    where: string
}

/** The book's bookmarks, as the controls show and change them. */
export interface Bookmarks {
    /** The bookmarks in book order. */
    rows(): BookmarkRow[]
    /** Whether a bookmark falls on the page shown. */
    marked(): boolean
    /** Bookmarks the page shown, or removes the bookmarks on it. */
    toggle(): Promise<void>
    /** Removes a bookmark. */
    remove(id: string): Promise<void>
    /** Goes to a bookmark, as a reader move. */
    go(id: string): Promise<void>
    /** Calls `changed` whenever the bookmarks change, as they load or are added or removed. */
    onChange(changed: () => void): void
    /** Where the bookmarks are (their CFIs), for the page count to place. */
    places(): string[]
}

/** What the bookmarks need: the server, and the book shown. */
export interface BookmarkSources {
    load(): Promise<Bookmark[] | null>
    add(cfi: string, fraction: number, text: string): Promise<Bookmark | null>
    remove(id: string): Promise<boolean>
    /** The page shown, or null before one is. */
    page(): PageMark | null
    /** Whether a place is on the page shown. */
    onPage(cfi: string): boolean
    /** The name of the chapter a place is in. */
    chapterOf(cfi: string): string
    /** The page a place is on, or null while progress shows the percent or the book is not counted. */
    pageOf(cfi: string): number | null
    go(cfi: string): Promise<void>
}

/**
 * The book's bookmarks, kept on the server. They load in the background; a
 * change shows once the server has taken it, so a failed one changes nothing.
 */
export const createBookmarks = (sources: BookmarkSources): Bookmarks => {
    let kept: Bookmark[] = []
    const listeners: (() => void)[] = []
    const changed = (): void => {
        kept.sort((a, b) => a.fraction - b.fraction || a.createdAt.localeCompare(b.createdAt))
        for (const listener of listeners) listener()
    }
    void sources.load().then(loaded => {
        if (!loaded) return
        // A bookmark added while the list loaded stays.
        const ids = new Set(loaded.map(bookmark => bookmark.id))
        kept = [...loaded, ...kept.filter(bookmark => !ids.has(bookmark.id))]
        changed()
    })
    const remove = async (id: string): Promise<void> => {
        if (!await sources.remove(id)) return
        kept = kept.filter(bookmark => bookmark.id !== id)
        changed()
    }
    return {
        rows: () => kept.map(({ id, cfi, fraction, text }) => ({ id, text, where: bookmarkWhere(sources.chapterOf(cfi), fraction, sources.pageOf(cfi)) })),
        marked: () => kept.some(bookmark => sources.onPage(bookmark.cfi)),
        async toggle() {
            const here = kept.filter(bookmark => sources.onPage(bookmark.cfi))
            if (here.length) {
                for (const { id } of here) await remove(id)
                return
            }
            const page = sources.page()
            if (!page) return
            const added = await sources.add(page.cfi, page.fraction, bookmarkText(page.text))
            if (!added) return
            kept = [...kept.filter(bookmark => bookmark.id !== added.id), added]
            changed()
        },
        remove,
        async go(id) {
            const bookmark = kept.find(candidate => candidate.id === id)
            if (bookmark) await sources.go(bookmark.cfi)
        },
        onChange(listener) {
            listeners.push(listener)
        },
        places: () => kept.map(bookmark => bookmark.cfi),
    }
}
