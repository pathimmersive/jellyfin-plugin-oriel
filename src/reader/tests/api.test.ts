import { afterEach, describe, expect, it, vi } from 'vitest'
import { BookLoadError, downloadBook, DownloadStalledError } from '../src/api/client'

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

describe('a download that stalls', () => {
    afterEach(() => { vi.useRealTimers() })

    // A server that answers and then sends what the test sends; the request's own signal ends it.
    const held = (answers = true) => {
        const state: { send: (text: string) => void, end: () => void, signal: AbortSignal | null } = { send: () => {}, end: () => {}, signal: null }
        const fetchImpl = ((_: string, init?: RequestInit) => {
            const signal = init?.signal ?? null
            state.signal = signal
            if (!answers) return new Promise((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason)))
            const body = new ReadableStream<Uint8Array>({
                start(controller) {
                    state.send = text => controller.enqueue(new TextEncoder().encode(text))
                    state.end = () => controller.close()
                    signal?.addEventListener('abort', () => controller.error(signal.reason))
                },
            })
            return Promise.resolve(new Response(body))
        }) as typeof fetch
        return { state, fetchImpl }
    }
    const outcome = (download: Promise<File>) => {
        const result: { file: File | null, error: unknown } = { file: null, error: null }
        void download.then(file => { result.file = file }, error => { result.error = error })
        return result
    }

    it('fails after 30 seconds without a byte, and drops the request', async () => {
        vi.useFakeTimers()
        const { state, fetchImpl } = held()
        const result = outcome(downloadBook('', 'abc', 'h', fetchImpl))
        await vi.advanceTimersByTimeAsync(1000)
        state.send('PK')
        await vi.advanceTimersByTimeAsync(27_000)
        expect(result.error).toBeNull()
        expect(state.signal?.aborted).toBe(false)
        await vi.advanceTimersByTimeAsync(5_000)
        expect(result.error).toBeInstanceOf(DownloadStalledError)
        expect(state.signal?.aborted).toBe(true)
    })

    it('fails the same when the server takes the request and never answers', async () => {
        vi.useFakeTimers()
        const { state, fetchImpl } = held(false)
        const result = outcome(downloadBook('', 'abc', 'h', fetchImpl))
        await vi.advanceTimersByTimeAsync(33_000)
        expect(result.error).toBeInstanceOf(DownloadStalledError)
        expect(state.signal?.aborted).toBe(true)
    })

    it('never stops a slow download that keeps sending', async () => {
        vi.useFakeTimers()
        const { state, fetchImpl } = held()
        const result = outcome(downloadBook('', 'abc', 'h', fetchImpl))
        for (let chunk = 0; chunk < 10; chunk++) {
            await vi.advanceTimersByTimeAsync(25_000)
            state.send('x')
        }
        state.end()
        await vi.advanceTimersByTimeAsync(0)
        expect(await result.file?.text()).toBe('xxxxxxxxxx')
    })

    it('leaves no timer behind, however the download ends', async () => {
        vi.useFakeTimers()
        const { state, fetchImpl } = held()
        const result = outcome(downloadBook('', 'abc', 'h', fetchImpl))
        await vi.advanceTimersByTimeAsync(0)
        state.end()
        await vi.advanceTimersByTimeAsync(0)
        expect(result.file).not.toBeNull()
        await downloadBook('', 'abc', 'h', respond(500).fetchImpl).catch(() => {})
        expect(vi.getTimerCount()).toBe(0)
    })

    it('passes on any other failure as it is', async () => {
        const lost = new TypeError('Load failed')
        const error = await downloadBook('', 'abc', 'h', (async () => { throw lost }) as typeof fetch).catch((e: unknown) => e)
        expect(error).toBe(lost)
    })
})
