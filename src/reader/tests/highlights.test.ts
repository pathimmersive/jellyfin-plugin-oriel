import { describe, expect, it } from 'vitest'
import type { Highlight } from '../src/api/client'
import { createHighlights, HIGHLIGHT_TEXT, highlighter, highlightFill, highlightText, type HighlightSources } from '../src/controls/highlights'
import { toolbarPlace } from '../src/controls/toolbar'

const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

// A server and a book whose places compare by the number in their CFI.
const sources = (stored: Highlight[] = [], overrides: Partial<HighlightSources> = {}) => {
    const server = [...stored]
    let next = 1
    const order = (cfi: string): number => Number(/^epubcfi\(\/6\/(\d+)/.exec(cfi)?.[1] ?? 0)
    const result: HighlightSources & { server: Highlight[] } = {
        server,
        load: async () => [...server],
        add: async (cfi, fraction, colour, text, note) => {
            const there = server.find(each => each.cfi === cfi)
            if (there) {
                Object.assign(there, { colour, note })
                return { ...there }
            }
            const highlight: Highlight = { id: `h${next++}`, cfi, fraction, colour, text, note, createdAt: `2026-11-02T12:00:0${next}Z` }
            server.push(highlight)
            return { ...highlight }
        },
        update: async (id, change) => {
            const there = server.find(each => each.id === id)
            if (!there) return null
            Object.assign(there, change)
            return { ...there }
        },
        remove: async id => {
            const at = server.findIndex(each => each.id === id)
            if (at >= 0) server.splice(at, 1)
            return true
        },
        compare: (a, b) => order(a) - order(b),
        chapterOf: cfi => order(cfi) < 5 ? 'Chapter One' : 'Chapter Three',
        go: async () => {},
        ...overrides,
    }
    return result
}

const stored = (id: string, cfi: string, colour: string, fraction = 0.1): Highlight =>
    ({ id, cfi, fraction, colour, text: `Text ${id}`, note: '', createdAt: '2026-11-01T00:00:00Z' })

describe('highlighters', () => {
    it('are the canvas\'s four, Quotes for a colour this reader does not know', () => {
        expect(['yellow', 'green', 'blue', 'pink'].map(colour => highlighter(colour).name)).toEqual(['Quotes', 'Green', 'Vocabulary', 'Pink'])
        expect(highlighter('purple').name).toBe('Quotes')
    })

    it('fill text with their colour at their strength', () => {
        expect(highlightFill(highlighter('yellow'))).toBe('rgba(255, 213, 79, 0.5)')
        expect(highlightFill(highlighter('pink'))).toBe('rgba(240, 98, 146, 0.38)')
    })
})

describe('highlightText', () => {
    it('evens out spaces and cuts long text at a word, within the limit', () => {
        expect(highlightText('  a truth\n universally  acknowledged ')).toBe('a truth universally acknowledged')
        const text = highlightText('word '.repeat(400))
        expect(text.length).toBeLessThanOrEqual(HIGHLIGHT_TEXT)
        expect(text.endsWith('word…')).toBe(true)
    })
})

describe('createHighlights', () => {
    it('loads the stored highlights in book order and tells of the change', async () => {
        const highlights = createHighlights(sources([stored('x', 'epubcfi(/6/8!/4/2,/1:0,/1:4)', 'pink', 0.6), stored('y', 'epubcfi(/6/2!/4/2,/1:0,/1:4)', 'yellow')]))
        let changes = 0
        highlights.onChange(() => changes++)
        await settle()

        expect(changes).toBe(1)
        expect(highlights.rows(null)).toEqual([
            { id: 'y', text: 'Text y', colour: 'yellow', note: '', where: 'Chapter One · 10%' },
            { id: 'x', text: 'Text x', colour: 'pink', note: '', where: 'Chapter Three · 60%' },
        ])
        expect(highlights.at('epubcfi(/6/8!/4/2,/1:0,/1:4)')?.id).toBe('x')
    })

    it('filters by colour', async () => {
        const highlights = createHighlights(sources([stored('x', 'epubcfi(/6/8)', 'pink'), stored('y', 'epubcfi(/6/2)', 'yellow')]))
        await settle()

        expect(highlights.rows('pink').map(row => row.id)).toEqual(['x'])
        expect(highlights.rows('green')).toEqual([])
    })

    it('adds, recolours and removes a highlight once the server has taken it', async () => {
        const from = sources()
        const highlights = createHighlights(from)
        await settle()

        expect(await highlights.add('epubcfi(/6/4)', 0.2, 'blue', 'a truth')).toBe(true)
        expect(highlights.all()).toEqual([expect.objectContaining({ id: 'h1', cfi: 'epubcfi(/6/4)', colour: 'blue', text: 'a truth' })])

        await highlights.update('h1', { colour: 'green' })
        expect(highlights.rows(null).map(row => row.colour)).toEqual(['green'])
        expect(from.server[0].colour).toBe('green')

        await highlights.remove('h1')
        expect(highlights.all()).toEqual([])
        expect(from.server).toEqual([])
    })

    it('keeps a note with a highlight, changes it and empties it', async () => {
        const from = sources()
        const highlights = createHighlights(from)
        await settle()

        await highlights.add('epubcfi(/6/4)', 0.2, 'yellow', 'a truth', 'The irony starts here.')
        expect(highlights.rows(null).map(row => row.note)).toEqual(['The irony starts here.'])
        await highlights.update('h1', { colour: 'blue', note: 'Edited.' })
        expect(highlights.rows(null).map(({ colour, note }) => ({ colour, note }))).toEqual([{ colour: 'blue', note: 'Edited.' }])
        await highlights.update('h1', { note: '' })
        expect(from.server[0]).toEqual(expect.objectContaining({ colour: 'blue', note: '' }))
    })

    it('keeps one highlight per place, in the colour last chosen', async () => {
        const highlights = createHighlights(sources())
        await settle()

        await highlights.add('epubcfi(/6/4)', 0.2, 'yellow', 'a truth')
        await highlights.add('epubcfi(/6/4)', 0.2, 'pink', 'a truth')
        expect(highlights.all().map(highlight => highlight.colour)).toEqual(['pink'])
    })

    it('changes nothing when the server does not take a change', async () => {
        const highlights = createHighlights(sources([stored('z', 'epubcfi(/6/2)', 'yellow')], {
            add: async () => null, update: async () => null, remove: async () => false,
        }))
        await settle()

        expect(await highlights.add('epubcfi(/6/4)', 0.2, 'blue', 'a truth')).toBe(false)
        await highlights.update('z', { colour: 'pink', note: 'Lost' })
        await highlights.remove('z')
        expect(highlights.rows(null)).toEqual([{ id: 'z', text: 'Text z', colour: 'yellow', note: '', where: 'Chapter One · 10%' }])
    })

    it('goes to a highlight by its id', async () => {
        const went: string[] = []
        const highlights = createHighlights(sources([stored('x', 'epubcfi(/6/8)', 'pink')], { go: async cfi => { went.push(cfi) } }))
        await settle()

        await highlights.go('x')
        await highlights.go('missing')
        expect(went).toEqual(['epubcfi(/6/8)'])
    })
})

describe('toolbarPlace', () => {
    const phone = { width: 390, height: 844 }
    const desktop = { width: 1280, height: 800 }

    it('goes below the text, 16 px from each side of a phone', () => {
        expect(toolbarPlace({ left: 40, top: 100, right: 300, bottom: 140 }, 70, phone, false)).toEqual({ left: 16, top: 148, width: 358 })
    })

    it('goes above the text when there is no room below', () => {
        expect(toolbarPlace({ left: 40, top: 700, right: 300, bottom: 790 }, 130, phone, false)).toEqual({ left: 16, top: 562, width: 358 })
    })

    it('stays on the screen when there is room neither below nor above', () => {
        expect(toolbarPlace({ left: 40, top: 60, right: 300, bottom: 800 }, 130, phone, false).top).toBe(698)
    })

    it('is 420 px wide at the text on a wider screen, kept on the screen', () => {
        expect(toolbarPlace({ left: 500, top: 200, right: 700, bottom: 230 }, 70, desktop, true)).toEqual({ left: 390, top: 238, width: 420 })
        expect(toolbarPlace({ left: 1200, top: 200, right: 1260, bottom: 230 }, 70, desktop, true).left).toBe(844)
        expect(toolbarPlace({ left: 0, top: 200, right: 40, bottom: 230 }, 70, desktop, true).left).toBe(16)
    })
})
