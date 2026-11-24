import { describe, expect, it } from 'vitest'
import { layoutKey, type PageCount } from '../src/controls/progress'
import { createPageCount } from '../src/start/page-count'

const landed = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve() }

// A book of two sections, three and ten pages, counted when the test says so.
const reader = () => {
    const state = {
        pages: true,
        beside: false,
        fixedLayout: false,
        layout: 'wide',
        marked: [] as string[],
        // Where a CFI is in the section shown.
        shown: {} as Record<string, { section: number, page: number }>,
        kept: {} as Record<string, PageCount>,
        changed: 0,
        runs: [] as { places: string[], cancelled: () => boolean, land: (entries?: Record<string, number>) => Promise<void> }[],
    }
    const count = createPageCount({
        book: {
            get fixedLayout() { return state.fixedLayout },
            layout: () => state.layout,
            count: (cancelled, places = []) => new Promise(resolve => state.runs.push({
                places,
                cancelled,
                land: async (entries = {}) => {
                    resolve({ sections: [3, 10], entries })
                    await landed()
                },
            })),
            pageShown: cfi => state.shown[cfi] ?? null,
        },
        pages: () => state.pages,
        beside: () => state.beside,
        marked: () => state.marked,
        read: key => state.kept[key] ?? null,
        write: (key, kept) => { state.kept[key] = structuredClone(kept) },
        changed: () => { state.changed++ },
    })
    return { state, count }
}

describe('counting', () => {
    it('counts once for a layout, keeps the count and shows it as it lands', async () => {
        const { state, count } = reader()
        count.recount()
        count.recount()
        expect(state.runs).toHaveLength(1)
        expect(count.count()).toBeNull()
        const before = state.changed
        await state.runs[0].land({ 'ch2.xhtml': 4 })
        expect(count.count()).toEqual({ sections: [3, 10], entries: { 'ch2.xhtml': 4 } })
        expect(state.kept[layoutKey('wide')]).toEqual(count.count())
        expect(state.changed).toBe(before + 1)
        count.recount()
        expect(state.runs).toHaveLength(1)
    })

    it('uses a count kept from before for the same layout at once, without counting', () => {
        const { state, count } = reader()
        state.kept[layoutKey('wide')] = { sections: [3, 10], entries: {} }
        count.recount()
        expect(count.count()).toEqual({ sections: [3, 10], entries: {} })
        expect(state.runs).toHaveLength(0)
    })

    it('drops the count for another layout, and stops the one under way', async () => {
        const { state, count } = reader()
        count.recount()
        state.layout = 'narrow'
        count.recount()
        expect(state.runs.map(run => run.cancelled())).toEqual([true, false])
        await state.runs[0].land({ old: 1 })
        expect(count.count()).toBeNull()
        await state.runs[1].land()
        state.layout = 'wide'
        count.recount()
        expect(count.count()).toBeNull()
    })

    it('counts nothing in Percentage mode or a fixed layout, and has no count there', async () => {
        const { state, count } = reader()
        count.recount()
        await state.runs[0].land()
        state.pages = false
        count.recount()
        expect(count.count()).toBeNull()
        state.pages = true
        state.fixedLayout = true
        count.recount()
        expect(state.runs).toHaveLength(1)
        expect(count.count()).toBeNull()
    })

    it('keeps the count as it is beside a panel, whose layout is not the book\'s', async () => {
        const { state, count } = reader()
        count.recount()
        await state.runs[0].land()
        state.beside = true
        state.layout = 'beside'
        const before = state.changed
        count.recount()
        count.recount(true)
        expect(state.runs).toHaveLength(1)
        expect(count.count()).not.toBeNull()
        expect(state.changed).toBe(before)
    })
})

describe('placing bookmarks and highlights', () => {
    it('has the count place the ones there are', () => {
        const { state, count } = reader()
        state.marked = ['a', 'b']
        count.recount()
        expect(state.runs[0].places).toEqual(['a', 'b'])
    })

    it('counts again for one that came after the count, keeping the count until the new one lands', async () => {
        const { state, count } = reader()
        count.recount()
        await state.runs[0].land()
        state.marked = ['later']
        count.placeMarked()
        expect(state.runs).toHaveLength(2)
        expect(count.count()).not.toBeNull()
        await state.runs[1].land({ later: 7 })
        expect(count.pageOf('later')).toBe(7)
    })

    it('tries a place once, when the count does not find it', async () => {
        const { state, count } = reader()
        state.marked = ['lost']
        count.recount()
        await state.runs[0].land()
        count.placeMarked()
        expect(state.runs).toHaveLength(1)
    })

    it('does not count again for one on the section shown, or while a count is under way', async () => {
        const { state, count } = reader()
        count.recount()
        state.marked = ['early']
        count.placeMarked()
        expect(state.runs).toHaveLength(1)
        await state.runs[0].land()
        expect(state.runs).toHaveLength(2)
        count.placeMarked()
        expect(state.runs).toHaveLength(2)
        await state.runs[1].land({ early: 1 })
        state.marked = ['early', 'here']
        state.shown = { here: { section: 1, page: 2 } }
        count.placeMarked()
        expect(state.runs).toHaveLength(2)
    })
})

describe('pageOf', () => {
    it('gives the page the count has', async () => {
        const { state, count } = reader()
        count.recount()
        expect(count.pageOf('a')).toBeNull()
        await state.runs[0].land({ a: 5 })
        expect(count.pageOf('a')).toBe(5)
        state.pages = false
        expect(count.pageOf('a')).toBeNull()
    })

    it('works out one on the section shown from the layout on screen, and keeps it', async () => {
        const { state, count } = reader()
        count.recount()
        await state.runs[0].land()
        state.shown = { here: { section: 1, page: 2 } }
        expect(count.pageOf('here')).toBe(6)
        expect(state.kept[layoutKey('wide')].entries).toEqual({ here: 6 })
        state.shown = {}
        expect(count.pageOf('here')).toBe(6)
    })

    it('does not work one out beside a panel, or in a section the count does not cover', async () => {
        const { state, count } = reader()
        count.recount()
        await state.runs[0].land()
        state.shown = { here: { section: 1, page: 2 }, past: { section: 2, page: 0 } }
        state.beside = true
        expect(count.pageOf('here')).toBeNull()
        state.beside = false
        expect(count.pageOf('past')).toBeNull()
    })
})
