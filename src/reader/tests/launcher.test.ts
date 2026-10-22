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
        expect(player.canPlayItem({ Path: '/media/books/manual.pdf' })).toBe(false)
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
