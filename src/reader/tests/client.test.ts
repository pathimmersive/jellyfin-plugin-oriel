import { describe, expect, it } from 'vitest'
import {
    addHighlight,
    publicServerId,
    readBookmarks,
    readFontFile,
    readFonts,
    readHighlighters,
    readHighlights,
    readStoredPosition,
    readThemes,
    removeBookmark,
    removeFontFamily,
    removeHighlight,
    saveHighlighters,
    saveThemes,
    updateHighlight,
} from '../src/api/client'
import { type OwnTheme, THEME_ROLES } from '../src/settings/settings'

// A fetch that answers every request with `status` and `body` (JSON unless a string), and records what it was asked.
const server = (status: number, body?: unknown) => {
    const calls: { url: string, init?: RequestInit }[] = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
        calls.push({ url, init })
        const text = body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body)
        return new Response(status === 204 ? null : text, { status, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch
    return { fetchImpl, calls }
}

// A fetch that cannot reach the server.
const offline = (async () => { throw new TypeError('Failed to fetch') }) as typeof fetch

const bookmark = { id: 'b1', cfi: 'epubcfi(/6/8!/4/2/1:0)', fraction: 0.25, text: 'A beginning', createdAt: '2026-11-15T09:30:00Z' }
const highlight = { id: 'h1', cfi: 'epubcfi(/6/8!/4/2,/1:0,/1:5)', fraction: 0.25, colour: 'quotes', text: 'A beg', note: '', createdAt: '2026-11-15T09:30:00Z' }
const highlighter = { id: 'quotes', name: 'Quotes', colour: '#f5c518', builtIn: true, uses: 3 }
const theme = { id: 't1', name: 'Night', ...Object.fromEntries(THEME_ROLES.map(([colour]) => [colour, '#101010'])) } as OwnTheme
const font = { id: 'f1', family: 'Charter', style: 'Regular', weight: 400, italic: false, format: 'ttf' }

// Each list the reader reads: what it asks for, the shape it accepts, and null for anything else.
const lists = [
    { name: 'readBookmarks', read: (f: typeof fetch) => readBookmarks('/jf', 'item1', 'auth', f), url: '/jf/Oriel/Bookmarks/item1', good: bookmark, bad: { ...bookmark, fraction: '0.25' } },
    { name: 'readHighlights', read: (f: typeof fetch) => readHighlights('/jf', 'item1', 'auth', f), url: '/jf/Oriel/Highlights/item1', good: highlight, bad: { ...highlight, note: null } },
    { name: 'readHighlighters', read: (f: typeof fetch) => readHighlighters('/jf', 'auth', f), url: '/jf/Oriel/Highlighters', good: highlighter, bad: { ...highlighter, builtIn: 'yes' } },
    { name: 'readThemes', read: (f: typeof fetch) => readThemes('/jf', 'auth', f), url: '/jf/Oriel/Themes', good: theme, bad: { id: 't1', name: 'Night' } },
    { name: 'readFonts', read: (f: typeof fetch) => readFonts('/jf', 'auth', f), url: '/jf/Oriel/Fonts', good: font, bad: { ...font, format: 'woff' } },
]

describe.each(lists)('$name', ({ read, url, good, bad }) => {
    it('asks for the list with the Authorization header and gives back what the server keeps', async () => {
        const { fetchImpl, calls } = server(200, [good])
        expect(await read(fetchImpl)).toEqual([good])
        expect(calls[0].url).toBe(url)
        expect(calls[0].init?.headers).toEqual({ Authorization: 'auth' })
    })

    it('gives null for a list holding anything of another shape', async () => {
        expect(await read(server(200, [good, bad]).fetchImpl)).toBeNull()
        expect(await read(server(200, { items: [good] }).fetchImpl)).toBeNull()
    })

    it('gives null for a refusal, a failure or no server at all', async () => {
        expect(await read(server(401).fetchImpl)).toBeNull()
        expect(await read(server(500, 'oops').fetchImpl)).toBeNull()
        expect(await read(server(200, 'not json').fetchImpl)).toBeNull()
        expect(await read(offline)).toBeNull()
    })
})

// Each removal: gone is gone, whether the server just removed it or no longer had it.
const removals = [
    { name: 'removeBookmark', remove: (f: typeof fetch) => removeBookmark('/jf', 'item1', 'auth', 'b 1', f), url: '/jf/Oriel/Bookmarks/item1/b%201' },
    { name: 'removeHighlight', remove: (f: typeof fetch) => removeHighlight('/jf', 'item1', 'auth', 'h1', f), url: '/jf/Oriel/Highlights/item1/h1' },
    { name: 'removeFontFamily', remove: (f: typeof fetch) => removeFontFamily('/jf', 'auth', 'Charter Sans', f), url: '/jf/Oriel/Fonts?family=Charter%20Sans' },
]

describe.each(removals)('$name', ({ remove, url }) => {
    it('sends DELETE and counts 204 and 404 as gone', async () => {
        const { fetchImpl, calls } = server(204)
        expect(await remove(fetchImpl)).toBe(true)
        expect(calls[0]).toMatchObject({ url, init: { method: 'DELETE', headers: { Authorization: 'auth' } } })
        expect(await remove(server(404).fetchImpl)).toBe(true)
    })

    it('counts a failure or no server as not gone', async () => {
        expect(await remove(server(500).fetchImpl)).toBe(false)
        expect(await remove(server(401).fetchImpl)).toBe(false)
        expect(await remove(offline)).toBe(false)
    })
})

describe('addHighlight and updateHighlight', () => {
    const add = (f: typeof fetch) => addHighlight('/jf', 'item1', 'auth', highlight.cfi, 0.25, 'quotes', 'A beg', 'Why', f)

    it('posts the highlight and gives back the one stored', async () => {
        const { fetchImpl, calls } = server(201, highlight)
        expect(await add(fetchImpl)).toEqual(highlight)
        expect(calls[0].url).toBe('/jf/Oriel/Highlights/item1')
        expect(JSON.parse(calls[0].init?.body as string)).toEqual({ cfi: highlight.cfi, fraction: 0.25, colour: 'quotes', text: 'A beg', note: 'Why' })
    })

    it('tells the limit apart from any other conflict', async () => {
        expect(await add(server(409, { reason: 'limitReached' }).fetchImpl)).toBe('limitReached')
        expect(await add(server(409, { reason: 'somethingElse' }).fetchImpl)).toBeNull()
        expect(await add(server(409).fetchImpl)).toBeNull()
    })

    it('gives null for an answer of another shape, a failure or no server', async () => {
        expect(await add(server(201, { ...highlight, colour: 3 }).fetchImpl)).toBeNull()
        expect(await add(server(500).fetchImpl)).toBeNull()
        expect(await add(offline)).toBeNull()
    })

    it('changes a highlight with PATCH, and counts the limit as a failure there', async () => {
        const { fetchImpl, calls } = server(200, { ...highlight, colour: 'green' })
        expect(await updateHighlight('/jf', 'item1', 'auth', 'h1', { colour: 'green' }, fetchImpl)).toEqual({ ...highlight, colour: 'green' })
        expect(calls[0]).toMatchObject({ url: '/jf/Oriel/Highlights/item1/h1', init: { method: 'PATCH' } })
        expect(await updateHighlight('/jf', 'item1', 'auth', 'h1', { note: 'x' }, server(409, { reason: 'limitReached' }).fetchImpl)).toBeNull()
    })
})

// Each whole list the reader saves: PUT the list, and take back the list as stored.
const saves = [
    { name: 'saveHighlighters', save: (f: typeof fetch) => saveHighlighters('/jf', 'auth', [{ name: 'Quotes', colour: '#f5c518' }], f), url: '/jf/Oriel/Highlighters', stored: highlighter },
    { name: 'saveThemes', save: (f: typeof fetch) => saveThemes('/jf', 'auth', [theme], f), url: '/jf/Oriel/Themes', stored: theme },
]

describe.each(saves)('$name', ({ save, url, stored }) => {
    it('puts the whole list as JSON and gives back the list as stored', async () => {
        const { fetchImpl, calls } = server(200, [stored])
        expect(await save(fetchImpl)).toEqual([stored])
        expect(calls[0]).toMatchObject({ url, init: { method: 'PUT', headers: { Authorization: 'auth', 'Content-Type': 'application/json' } } })
        expect(Array.isArray(JSON.parse(calls[0].init?.body as string))).toBe(true)
    })

    it('gives null for a refusal, an answer of another shape or no server', async () => {
        expect(await save(server(400, { reason: 'invalid' }).fetchImpl)).toBeNull()
        expect(await save(server(200, [{ id: 'x' }]).fetchImpl)).toBeNull()
        expect(await save(offline)).toBeNull()
    })
})

describe('readFontFile', () => {
    it('reads a font file by its id', async () => {
        const { fetchImpl, calls } = server(200, 'wOF2')
        expect(await (await readFontFile('/jf', 'auth', 'f 1', fetchImpl))?.text()).toBe('wOF2')
        expect(calls[0].url).toBe('/jf/Oriel/Fonts/f%201')
    })

    it('gives null for a missing file or no server', async () => {
        expect(await readFontFile('/jf', 'auth', 'f1', server(404).fetchImpl)).toBeNull()
        expect(await readFontFile('/jf', 'auth', 'f1', offline)).toBeNull()
    })
})

describe('readStoredPosition', () => {
    it('says the store is unavailable only when the server says so', async () => {
        expect(await readStoredPosition('/jf', 'item1', 'auth', server(503, { reason: 'storeUnavailable' }).fetchImpl)).toBe('unavailable')
        expect(await readStoredPosition('/jf', 'item1', 'auth', server(503, 'Service Unavailable').fetchImpl)).toBeNull()
    })
})

describe('publicServerId', () => {
    it('gives up after the time allowed', async () => {
        // A server that never answers until the request is aborted.
        const hanging = ((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        })) as typeof fetch
        const started = Date.now()
        expect(await publicServerId('/jf', hanging, 50)).toBeNull()
        expect(Date.now() - started).toBeLessThan(2000)
    })
})
