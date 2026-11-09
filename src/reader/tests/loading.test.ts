import { describe, expect, it } from 'vitest'
import { downloadBook, readBookDetails } from '../src/api/client'
import { downloadLine, downloadShare } from '../src/loading/loading'

// A response whose body arrives in the given chunks.
const streamed = (chunks: string[], headers: Record<string, string> = {}): typeof fetch => (async () => {
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
            controller.close()
        },
    })
    return new Response(body, { headers })
}) as typeof fetch

describe('downloadLine', () => {
    it('gives what has arrived of the size, in megabytes of 1,000,000 bytes to one decimal place', () => {
        expect(downloadLine(12_900_000, 24_900_000)).toBe('Downloading · 12.9 of 24.9 MB')
        expect(downloadLine(0, 3_000_000)).toBe('Downloading · 0.0 of 3.0 MB')
    })

    it('gives only what has arrived when the size is not known', () => {
        expect(downloadLine(1_250_000, null)).toBe('Downloading · 1.3 MB')
    })

    it('never gives more than the size', () => {
        expect(downloadLine(5_000_000, 4_000_000)).toBe('Downloading · 4.0 of 4.0 MB')
    })
})

describe('downloadShare', () => {
    it('is the whole percent that has arrived, at most 100', () => {
        expect(downloadShare(12_900_000, 24_900_000)).toBe(51)
        expect(downloadShare(24_900_000, 24_900_000)).toBe(100)
        expect(downloadShare(30, 20)).toBe(100)
    })

    it('is null when the size is not known', () => {
        expect(downloadShare(100, null)).toBeNull()
    })
})

describe('downloadBook progress', () => {
    it('reports the bytes as each chunk arrives, of the Content-Length', async () => {
        const seen: [number, number | null][] = []
        const file = await downloadBook('', 'abc', 'h', streamed(['PK', 'abc', 'de'], { 'Content-Length': '7', 'Content-Type': 'application/epub+zip' }), (done, total) => seen.push([done, total]))

        expect(seen).toEqual([[0, 7], [2, 7], [5, 7], [7, 7]])
        expect(await file.text()).toBe('PKabcde')
        expect(file.type).toBe('application/epub+zip')
    })

    it('reports no size without a Content-Length, or when the body is encoded', async () => {
        const seen: (number | null)[] = []
        await downloadBook('', 'abc', 'h', streamed(['PK']), (_, total) => seen.push(total))
        await downloadBook('', 'abc', 'h', streamed(['PK'], { 'Content-Length': '1', 'Content-Encoding': 'gzip' }), (_, total) => seen.push(total))

        expect(seen).toEqual([null, null, null, null])
    })
})

describe('readBookDetails', () => {
    it('reads the title and the cover from /Items/{id} under the base path', async () => {
        const calls: { url: string, init?: RequestInit }[] = []
        const fetchImpl = (async (url: string, init?: RequestInit) => {
            calls.push({ url, init })
            return Response.json({ Name: 'Pride and Prejudice', ImageTags: { Primary: 't1' } })
        }) as typeof fetch

        expect(await readBookDetails('/jf', 'abc', 'u1', 'MediaBrowser Token="t"', fetchImpl)).toEqual({
            title: 'Pride and Prejudice',
            cover: '/jf/Items/abc/Images/Primary?tag=t1&maxWidth=360',
        })
        expect(calls[0].url).toBe('/jf/Items/abc?userId=u1')
        expect(calls[0].init?.headers).toEqual({ Authorization: 'MediaBrowser Token="t"' })
    })

    it('gives no cover for a book without a primary image', async () => {
        const fetchImpl = (async () => Response.json({ Name: 'Oriel', ImageTags: {} })) as typeof fetch
        expect(await readBookDetails('', 'abc', 'u1', 'h', fetchImpl)).toEqual({ title: 'Oriel', cover: null })
    })

    it('gives null when the details cannot be read', async () => {
        expect(await readBookDetails('', 'abc', 'u1', 'h', (async () => new Response(null, { status: 500 })) as typeof fetch)).toBeNull()
        expect(await readBookDetails('', 'abc', 'u1', 'h', (async () => { throw new TypeError('offline') }) as typeof fetch)).toBeNull()
    })
})
