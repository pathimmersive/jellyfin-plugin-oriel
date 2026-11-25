import { describe, expect, it } from 'vitest'
import type { Highlight } from '../src/api/client'
import { createHighlights } from '../src/controls/highlights'
import { type Cfi, type CfiReader, createPlaces, createSectionOf } from '../src/engine/places'
import * as untypedCfi from '../vendor/foliate-js/epubcfi.js'

const CFI: Cfi = untypedCfi

// foliate-js's own CFI functions, counting the parses.
const counting = () => {
    const parsed: string[] = []
    const reader: CfiReader = {
        parse(cfi) {
            parsed.push(cfi)
            return CFI.parse(cfi)
        },
        collapse: (place, toEnd) => CFI.collapse(place, toEnd),
        compare: (a, b) => CFI.compare(a, b),
    }
    return { parsed, places: createPlaces(reader) }
}

const point = (section: number, element: number, at = 0): string => `epubcfi(/6/${section * 2}!/4/${element * 2}/1:${at})`
const range = (section: number, element: number, from: number, to: number): string => `epubcfi(/6/${section * 2}!/4/${element * 2},/1:${from},/1:${to})`

describe('compare', () => {
    it('orders places as foliate-js does', () => {
        const { places } = counting()
        const all = [point(1, 1), point(1, 1, 5), range(1, 1, 5, 9), range(1, 1, 5, 12), point(1, 3), range(1, 12, 0, 4), point(2, 1), point(11, 1), 'epubcfi(/6/4)']
        for (const a of all) {
            for (const b of all) {
                const want: number = CFI.compare(a, b)
                expect(Math.sign(places.compare(a, b)), `${a} and ${b}`).toBe(want)
            }
        }
    })

    it('parses each place once, however often it is compared', () => {
        const { parsed, places } = counting()
        const all = Array.from({ length: 200 }, (_, i) => range(i % 7 + 1, i % 50 + 1, i, i + 3))
        all.sort(places.compare)
        expect(parsed).toHaveLength(200)
        all.sort(places.compare)
        expect(parsed).toHaveLength(200)
    })

    it('puts a place that cannot be read after every other, and parses it once', () => {
        const { parsed, places } = counting()
        const all = ['epubcfi(:3)', point(2, 1), 'epubcfi(~1)', point(1, 1)]
        expect([...all].sort(places.compare)).toEqual([point(1, 1), point(2, 1), 'epubcfi(:3)', 'epubcfi(~1)'])
        expect(places.compare('epubcfi(:3)', 'epubcfi(~1)')).toBe(0)
        expect(parsed).toHaveLength(4)
    })
})

describe('fromPage', () => {
    const page = 'epubcfi(/6/4!/4,/4/1:10,/8/1:20)'

    it('tells a place before the page, on it, from its first character to its last, and after it', () => {
        const { places } = counting()
        const from = (cfi: string): number => Math.sign(places.fromPage(cfi, page))
        expect([point(1, 90), point(2, 1), point(2, 2, 9)].map(from)).toEqual([-1, -1, -1])
        expect([point(2, 2, 10), point(2, 3), point(2, 4, 20)].map(from)).toEqual([0, 0, 0])
        expect([point(2, 4, 21), point(2, 5), point(3, 1)].map(from)).toEqual([1, 1, 1])
    })

    it('parses the page shown once for each page, and each place once', () => {
        const { parsed, places } = counting()
        const marks = Array.from({ length: 20 }, (_, i) => point(2, i + 1))
        for (const cfi of marks) places.fromPage(cfi, page)
        expect(parsed).toHaveLength(21)
        for (const cfi of marks) places.fromPage(cfi, 'epubcfi(/6/4!/4,/8/1:21,/12/1:3)')
        expect(parsed).toHaveLength(22)
    })

    it('counts nothing as on a page when either cannot be read', () => {
        const { places } = counting()
        expect(places.fromPage('epubcfi(:3)', page)).toBe(1)
        expect(places.fromPage(point(2, 3), 'epubcfi(:3)')).toBe(1)
    })
})

describe('highlights kept in order', () => {
    it('parse only the place added when one is, and none when one is changed or removed', async () => {
        const { parsed, places } = counting()
        const highlight = (id: string, cfi: string): Highlight => ({ id, cfi, fraction: 0.5, colour: 'yellow', text: id, note: '', createdAt: '2026-11-01T00:00:00Z' })
        const stored = Array.from({ length: 300 }, (_, i) => highlight(`s${i}`, range(40 - i % 40, i + 1, 0, 4)))
        const highlights = createHighlights({
            load: () => Promise.resolve(stored),
            add: cfi => Promise.resolve(highlight('new', cfi)),
            update: (id, change) => Promise.resolve({ ...stored.find(each => each.id === id)!, ...change }),
            remove: () => Promise.resolve(true),
            compare: places.compare,
            chapterOf: () => '',
            pageOf: () => null,
            go: () => Promise.resolve(),
        })
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(parsed).toHaveLength(300)
        const inOrder = (): void => {
            const cfis = highlights.all().map(each => each.cfi)
            expect(cfis).toEqual([...cfis].sort((a, b) => CFI.compare(a, b)))
        }
        inOrder()

        await highlights.add(range(20, 7, 2, 6), 0.5, 'yellow', 'new')
        expect(parsed).toHaveLength(301)
        expect(highlights.all()).toHaveLength(301)
        inOrder()
        await highlights.update('s17', { colour: 'pink' })
        await highlights.remove('s18')
        expect(parsed).toHaveLength(301)
        expect(highlights.all()).toHaveLength(300)
        inOrder()
    })
})

describe('createSectionOf', () => {
    it('works out the section once for the places that share it', () => {
        const asked: string[] = []
        const sectionOf = createSectionOf(cfi => {
            asked.push(cfi)
            return cfi.startsWith('epubcfi(/6/99') ? null : Number(/\/6\/(\d+)/.exec(cfi)![1])
        })
        expect([point(1, 1), point(1, 9, 4), range(1, 3, 0, 2), point(11, 1), point(11, 2)].map(sectionOf)).toEqual([2, 2, 2, 22, 22])
        expect(asked).toEqual([point(1, 1), point(11, 1)])
        expect(['epubcfi(/6/99!/4)', 'epubcfi(/6/99!/6)'].map(sectionOf)).toEqual([null, null])
        expect(asked).toHaveLength(3)
    })

    it('works out each place that names no part of a section', () => {
        expect(['epubcfi(/6/4)', 'epubcfi(/6/8)'].map(createSectionOf(cfi => Number(/\/6\/(\d+)/.exec(cfi)![1])))).toEqual([4, 8])
    })
})
