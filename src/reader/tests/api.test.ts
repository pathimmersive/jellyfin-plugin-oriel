import { describe, expect, it } from 'vitest'
import { BookLoadError, downloadBook } from '../src/api/client'

const respond = (status: number, body = '') => {
    const calls: { url: string, init?: RequestInit }[] = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
        calls.push({ url, init })
        return new Response(status === 200 ? body : null, { status })
    }) as typeof fetch
    return { fetchImpl, calls }
}

describe('downloadBook', () => {
    it('fetches /Items/{id}/Download under the base path with the Authorization header', async () => {
        const { fetchImpl, calls } = respond(200, 'PK')
        const file = await downloadBook('/jf', 'abc', 'MediaBrowser Token="t"', fetchImpl)

        expect(calls).toHaveLength(1)
        expect(calls[0].url).toBe('/jf/Items/abc/Download')
        expect(calls[0].init?.headers).toEqual({ Authorization: 'MediaBrowser Token="t"' })
        expect(await file.text()).toBe('PK')
        expect(file.name).toBe('abc.epub')
    })

    it('names the file as the server does, lower-cased, so foliate-js can tell a comic by its name', async () => {
        const fetchImpl = (async () => new Response('PK', {
            headers: { 'Content-Disposition': "attachment; filename=Oriel-Comic.CBZ; filename*=UTF-8''Oriel-Comic.CBZ" },
        })) as typeof fetch
        expect((await downloadBook('', 'abc', 'h', fetchImpl)).name).toBe('oriel-comic.cbz')
    })

    it.each([
        [401, /session has expired/],
        [403, /permission to download/],
        [404, /not found/],
        [500, /HTTP 500/],
    ])('turns HTTP %i into a message', async (status, message) => {
        const { fetchImpl } = respond(status)
        const error = await downloadBook('', 'abc', 'h', fetchImpl).catch((e: unknown) => e)

        expect(error).toBeInstanceOf(BookLoadError)
        expect((error as BookLoadError).status).toBe(status)
        expect((error as BookLoadError).message).toMatch(message)
    })
})
