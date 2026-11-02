import { describe, expect, it } from 'vitest'
import type { Bookmark } from '../src/api/client'
import { BOOKMARK_TEXT, bookmarkText, bookmarkWhere, type BookmarkSources, createBookmarks } from '../src/controls/bookmarks'

const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

// A server and a book: `shown` is the CFI of the page shown, and a bookmark is on it when its CFI matches.
const sources = (stored: Bookmark[] = [], overrides: Partial<BookmarkSources> = {}) => {
    const server = [...stored]
    const book = { shown: 'epubcfi(/6/2!/4/2)', fraction: 0.1 }
    let next = 1
    const result: BookmarkSources & { server: Bookmark[], book: typeof book } = {
        server,
        book,
        load: async () => [...server],
        add: async (cfi, fraction, text) => {
            const bookmark = server.find(each => each.cfi === cfi)
                ?? { id: `b${next++}`, cfi, fraction, text, createdAt: `2026-11-02T12:00:0${next}Z` }
            if (!server.includes(bookmark)) server.push(bookmark)
            return bookmark
        },
        remove: async id => {
            const at = server.findIndex(each => each.id === id)
            if (at >= 0) server.splice(at, 1)
            return true
        },
        page: () => ({ cfi: book.shown, fraction: book.fraction, text: 'Chapter One  Oriel smoke chapter one opens here.' }),
        onPage: cfi => cfi === book.shown,
        chapterOf: cfi => cfi.includes('/6/2!') ? 'Chapter One' : 'Chapter Three',
        go: async () => {},
        ...overrides,
    }
    return result
}

describe('bookmarkText', () => {
    it('evens out spaces and keeps short text whole', () => {
        expect(bookmarkText('  Chapter One\n\n  Oriel smoke  ')).toBe('Chapter One Oriel smoke')
    })

    it('cuts long text at a word, within the limit', () => {
        const text = bookmarkText('word '.repeat(100))
        expect(text.length).toBeLessThanOrEqual(BOOKMARK_TEXT)
        expect(text.endsWith('word…')).toBe(true)
    })
})

describe('bookmarkWhere', () => {
    it('gives the chapter and the percent, or the percent alone', () => {
        expect(bookmarkWhere('Chapter Two', 0.344)).toBe('Chapter Two · 34%')
        expect(bookmarkWhere('', 0.5)).toBe('50%')
    })
})

describe('createBookmarks', () => {
    it('bookmarks the page shown, and a second toggle removes it', async () => {
        const from = sources()
        const bookmarks = createBookmarks(from)
        await settle()
        expect(bookmarks.marked()).toBe(false)

        await bookmarks.toggle()
        expect(bookmarks.marked()).toBe(true)
        expect(from.server).toEqual([expect.objectContaining({ cfi: from.book.shown, text: 'Chapter One Oriel smoke chapter one opens here.' })])
        expect(bookmarks.rows()).toEqual([{ id: 'b1', text: 'Chapter One Oriel smoke chapter one opens here.', where: 'Chapter One · 10%' }])

        await bookmarks.toggle()
        expect(bookmarks.marked()).toBe(false)
        expect(from.server).toEqual([])
    })

    it('loads the stored bookmarks in book order and tells of the change', async () => {
        const later = { id: 'x', cfi: 'epubcfi(/6/8!/4/2)', fraction: 0.6, text: 'Later', createdAt: '2026-11-01T00:00:00Z' }
        const earlier = { id: 'y', cfi: 'epubcfi(/6/2!/4/2)', fraction: 0.1, text: 'Earlier', createdAt: '2026-11-01T00:00:01Z' }
        const bookmarks = createBookmarks(sources([later, earlier]))
        let changes = 0
        bookmarks.onChange(() => changes++)
        await settle()

        expect(changes).toBe(1)
        expect(bookmarks.rows().map(row => row.id)).toEqual(['y', 'x'])
        expect(bookmarks.marked()).toBe(true)
    })

    it('changes nothing when the server does not take a change', async () => {
        const from = sources([], { add: async () => null, remove: async () => false })
        const bookmarks = createBookmarks(from)
        await settle()

        await bookmarks.toggle()
        expect(bookmarks.rows()).toEqual([])

        const stored = createBookmarks(sources([{ id: 'z', cfi: 'epubcfi(/6/2!/4/2)', fraction: 0.1, text: 'Kept', createdAt: '2026-11-01T00:00:00Z' }], { remove: async () => false }))
        await settle()
        await stored.remove('z')
        expect(stored.rows().map(row => row.id)).toEqual(['z'])
    })

    it('goes to a bookmark by its id', async () => {
        const went: string[] = []
        const bookmarks = createBookmarks(sources([{ id: 'x', cfi: 'epubcfi(/6/8!/4/2)', fraction: 0.6, text: 'Later', createdAt: '2026-11-01T00:00:00Z' }], { go: async cfi => { went.push(cfi) } }))
        await settle()

        await bookmarks.go('x')
        await bookmarks.go('missing')
        expect(went).toEqual(['epubcfi(/6/8!/4/2)'])
    })
})
