import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

// The jellyfin-web launcher is a classic script, so it runs here the way the
// browser runs it: once, against a window object.
const source = readFileSync(new URL('../../integration/launcher.js', import.meta.url), 'utf8')

interface Player {
    priority: number
    type: string
    canPlayMediaType(mediaType: string): boolean
    canPlayItem(item: { Path?: string }): boolean
    play(options: { items: { Id?: string }[] }): Promise<void>
}

const load = (pathname: string) => {
    const assign = vi.fn()
    const warn = vi.fn()
    const listeners: Record<string, () => void> = {}
    const timers: (() => void)[] = []
    const window: Record<string, unknown> = {
        location: { pathname, assign },
        addEventListener: (type: string, listener: () => void) => { listeners[type] = listener },
    }
    runInNewContext(source, {
        window,
        console: { warn },
        setTimeout: (callback: () => void) => { timers.push(callback) },
        Promise,
    })
    // What jellyfin-web's loadPlugin does with a name found on window.
    const createPlayer = async (): Promise<Player> => {
        const Class = await (window.OrielBookPlayer as () => Promise<new (deps: object) => Player>)()
        return new Class({})
    }
    const pageLoaded = () => { listeners.load(); timers.forEach(callback => callback()) }
    return { window, assign, warn, createPlayer, pageLoaded }
}

describe('launcher', () => {
    it('defines a factory on window that resolves to a player class', async () => {
        const { window, createPlayer } = load('/web/')
        expect(typeof window.OrielBookPlayer).toBe('function')
        const player = await createPlayer()
        expect(player.type).toBe('mediaplayer')
        // The built-in book player is priority 1; lower is chosen first.
        expect(player.priority).toBe(0)
    })

    it('claims EPUB books only', async () => {
        const player = await load('/web/').createPlayer()
        expect(player.canPlayMediaType('Book')).toBe(true)
        expect(player.canPlayMediaType('Video')).toBe(false)
        expect(player.canPlayItem({ Path: '/media/books/Pillars.epub' })).toBe(true)
        expect(player.canPlayItem({ Path: '/media/books/Pillars.EPUB' })).toBe(true)
        expect(player.canPlayItem({ Path: '/media/books/Comic.cbz' })).toBe(true)
        expect(player.canPlayItem({ Path: '/media/books/Comic.CBZ' })).toBe(true)
        for (const kindle of ['Novel.mobi', 'Novel.MOBI', 'Novel.azw', 'Novel.azw3', 'Novel.AZW3']) {
            expect(player.canPlayItem({ Path: `/media/books/${kindle}` })).toBe(true)
        }
        for (const other of ['manual.pdf', 'novel.fb2', 'comic.cbr', 'comic.cb7', 'novel.azw4']) {
            expect(player.canPlayItem({ Path: `/media/books/${other}` })).toBe(false)
        }
        expect(player.canPlayItem({})).toBe(false)
    })

    it.each([
        ['/web/', '/Oriel/?id=abc123'],
        ['/web/index.html', '/Oriel/?id=abc123'],
        ['/jf/web/', '/jf/Oriel/?id=abc123'],
    ])('opens the book in Oriel from %s', async (pathname, expected) => {
        const { createPlayer, assign } = load(pathname)
        await (await createPlayer()).play({ items: [{ Id: 'abc123' }] })
        expect(assign).toHaveBeenCalledWith(expected)
    })

    it('refuses to play without an item', async () => {
        const { createPlayer, assign } = load('/web/')
        await expect((await createPlayer()).play({ items: [] })).rejects.toThrow('no book')
        expect(assign).not.toHaveBeenCalled()
    })

    it('warns once when jellyfin-web never asks for the player', () => {
        const { pageLoaded, warn } = load('/web/')
        pageLoaded()
        expect(warn).toHaveBeenCalledTimes(1)
        expect(warn.mock.calls[0][0]).toMatch(/built-in book player/)
    })

    it('stays quiet when jellyfin-web loaded the player', async () => {
        const { createPlayer, pageLoaded, warn } = load('/web/')
        await createPlayer()
        pageLoaded()
        expect(warn).not.toHaveBeenCalled()
    })
})

describe('return after sign-in', () => {
    const ITEM = '3d180653ee958ef40e0ea24db3142dea'
    const NOW = 1_800_000_000_000

    // A jellyfin-web page with storage, a hash route and an interval timer.
    const page = (pathname: string, hash: string, stored: string | null) => {
        const items = new Map<string, string>()
        if (stored !== null) items.set('oriel_return', stored)
        const replace = vi.fn()
        const intervals: (() => void)[] = []
        const listeners: Record<string, () => void> = {}
        const window: Record<string, unknown> = {
            location: { pathname, hash, assign: vi.fn(), replace },
            localStorage: {
                getItem: (key: string) => items.get(key) ?? null,
                removeItem: (key: string) => { items.delete(key) },
            },
            addEventListener: (type: string, listener: () => void) => { listeners[type] = listener },
            removeEventListener: (type: string) => { delete listeners[type] },
            setInterval: (callback: () => void) => { intervals.push(callback); return intervals.length },
            clearInterval: () => { intervals.length = 0 },
        }
        runInNewContext(source, {
            window,
            console: { warn: vi.fn() },
            setTimeout: () => {},
            Promise,
            Date: { now: () => NOW },
            JSON,
            decodeURIComponent,
        })
        const navigateTo = (newHash: string) => {
            (window.location as { hash: string }).hash = newHash
            listeners.hashchange?.()
        }
        const tick = () => intervals.forEach(callback => callback())
        return { items, replace, intervals, navigateTo, tick }
    }
    const marker = (id: string, at: number) => JSON.stringify({ id, at })

    it('does nothing without a marker', () => {
        const p = page('/web/', '#/home', null)
        expect(p.intervals).toHaveLength(0)
        expect(p.replace).not.toHaveBeenCalled()
    })

    it('opens the book in Oriel once its detail page shows after sign-in', () => {
        const p = page('/web/', '#/login?url=%2Fdetails%3Fid%3D' + ITEM, marker(ITEM, NOW - 1000))
        p.tick()
        expect(p.replace).not.toHaveBeenCalled()
        p.navigateTo(`#/details?id=${ITEM}&serverId=abc`)
        expect(p.replace).toHaveBeenCalledWith(`/Oriel/?id=${ITEM}`)
        expect(p.items.has('oriel_return')).toBe(false)
        expect(p.intervals).toHaveLength(0)
    })

    it('keeps the BaseUrl', () => {
        const p = page('/jf/web/', `#/details?id=${ITEM}`, marker(ITEM, NOW))
        expect(p.replace).toHaveBeenCalledWith(`/jf/Oriel/?id=${ITEM}`)
    })

    it('stays on the detail page of another book', () => {
        const p = page('/web/', '#/details?id=ffffffffffffffffffffffffffffffff', marker(ITEM, NOW))
        p.tick()
        expect(p.replace).not.toHaveBeenCalled()
        expect(p.items.has('oriel_return')).toBe(true)
    })

    it('drops a marker older than ten minutes without navigating', () => {
        const p = page('/web/', `#/details?id=${ITEM}`, marker(ITEM, NOW - 11 * 60 * 1000))
        expect(p.replace).not.toHaveBeenCalled()
        expect(p.items.has('oriel_return')).toBe(false)
    })

    it('drops a marker whose id is not an item id without navigating', () => {
        for (const bad of [marker('https://example.com/', NOW), marker('../x', NOW), '{"id":42,"at":0}', 'not json']) {
            const p = page('/web/', '#/details?id=https://example.com/', bad)
            expect(p.replace).not.toHaveBeenCalled()
            expect(p.items.has('oriel_return')).toBe(false)
        }
    })

    const dataMarker = (id: string | undefined, at: number) => JSON.stringify({ page: 'data', id, at })

    it('opens the reading data page for its book once sign-in reaches the home page', () => {
        const p = page('/web/', '#/login', dataMarker(ITEM, NOW - 1000))
        p.tick()
        expect(p.replace).not.toHaveBeenCalled()
        p.navigateTo('#/home')
        expect(p.replace).toHaveBeenCalledWith(`/Oriel/data.html?id=${ITEM}`)
        expect(p.items.has('oriel_return')).toBe(false)
    })

    it('opens the reading data page without a book, under the BaseUrl', () => {
        const p = page('/jf/web/', '#/home', dataMarker(undefined, NOW))
        expect(p.replace).toHaveBeenCalledWith('/jf/Oriel/data.html')
    })

    it('does not open the reading data page from a book detail page', () => {
        const p = page('/web/', `#/details?id=${ITEM}`, dataMarker(ITEM, NOW))
        p.tick()
        expect(p.replace).not.toHaveBeenCalled()
    })

    it('drops a reading data marker with a bad id or an unknown page', () => {
        for (const bad of [dataMarker('../x', NOW), JSON.stringify({ page: 'elsewhere', id: ITEM, at: NOW })]) {
            const p = page('/web/', '#/home', bad)
            expect(p.replace).not.toHaveBeenCalled()
            expect(p.items.has('oriel_return')).toBe(false)
        }
    })
})
