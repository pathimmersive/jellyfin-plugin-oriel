import { describe, expect, it } from 'vitest'
import { layoutKey, type PageCount, pageNumber, pagesLeftName, percent, progressShown, readCount, totalPages, writeCount } from '../src/controls/progress'

const COUNT: PageCount = { sections: [3, 10, 0, 7], entries: { 'ch1.xhtml': 1, 'ch2.xhtml': 4, 'ch2.xhtml#half': 9 } }

const memory = (): { getItem: (key: string) => string | null, setItem: (key: string, value: string) => void } => {
    const kept = new Map<string, string>()
    return { getItem: key => kept.get(key) ?? null, setItem: (key, value) => { kept.set(key, value) } }
}

describe('percent', () => {
    it('rounds the fraction read to a whole percent within 0 to 100', () => {
        expect(percent(0.126)).toBe('13%')
        expect(percent(-0.2)).toBe('0%')
        expect(percent(1.4)).toBe('100%')
    })
})

describe('pagesLeftName', () => {
    it('names the pages left for a screen reader, one page in the singular', () => {
        expect(pagesLeftName(5)).toBe('5 pages left in this chapter')
        expect(pagesLeftName(1)).toBe('1 page left in this chapter')
        expect(pagesLeftName(0)).toBe('0 pages left in this chapter')
    })
})

describe('totalPages and pageNumber', () => {
    it('adds every section\'s pages, and numbers a page from 1 through the book', () => {
        expect(totalPages(COUNT)).toBe(20)
        expect(pageNumber(COUNT, 0, 0)).toBe(1)
        expect(pageNumber(COUNT, 1, 2)).toBe(6)
        expect(pageNumber(COUNT, 3, 6)).toBe(20)
    })
})

describe('progressShown', () => {
    const shown = { section: 1, first: 2, last: 3, left: 4 }

    it('shows the percent in Percentage mode', () => {
        expect(progressShown('percent', 0.3, COUNT, shown)).toEqual({ text: '30%', counting: false })
    })

    it('shows page / total in Pages mode once counted', () => {
        expect(progressShown('pages', 0.3, COUNT, shown)).toEqual({ text: '6/20', counting: false })
    })

    it('shows Counting pages with the percent until the count is in, or when it does not cover the section', () => {
        expect(progressShown('pages', 0.3, null, shown)).toEqual({ text: '30%', counting: true })
        expect(progressShown('pages', 0.3, { sections: [3], entries: {} }, shown)).toEqual({ text: '30%', counting: true })
    })

    it('shows the percent only for a book without pages, whichever mode', () => {
        expect(progressShown('pages', 0.5, COUNT, null)).toEqual({ text: '50%', counting: false })
    })
})

describe('layoutKey', () => {
    it('gives the same key for the same layout and another for another', () => {
        expect(layoutKey('390x796|0.1%|p { line-height: 1.5 }')).toBe(layoutKey('390x796|0.1%|p { line-height: 1.5 }'))
        expect(layoutKey('390x796|0.1%|p { line-height: 1.5 }')).not.toBe(layoutKey('390x796|0.1%|p { line-height: 1.6 }'))
    })
})

describe('readCount and writeCount', () => {
    it('gives back a count only for the same book and layout', () => {
        const storage = memory()
        writeCount(storage, 'book-a', 'k1', COUNT)
        expect(readCount(storage, 'book-a', 'k1')).toEqual(COUNT)
        expect(readCount(storage, 'book-a', 'k2')).toBeNull()
        expect(readCount(storage, 'book-b', 'k1')).toBeNull()
    })

    it('keeps one layout a book, and the 20 books counted last', () => {
        const storage = memory()
        writeCount(storage, 'book-a', 'k1', COUNT)
        writeCount(storage, 'book-a', 'k2', COUNT)
        expect(readCount(storage, 'book-a', 'k1')).toBeNull()
        for (let i = 0; i < 20; i++) writeCount(storage, `other-${i}`, 'k', COUNT)
        expect(readCount(storage, 'book-a', 'k2')).toBeNull()
        expect(readCount(storage, 'other-0', 'k')).toEqual(COUNT)
    })

    it('ignores storage it cannot read and counts that are not whole pages', () => {
        expect(readCount({ getItem: () => 'not json' }, 'book-a', 'k1')).toBeNull()
        const bad = JSON.stringify([{ book: 'book-a', layout: 'k1', count: { sections: [1.5], entries: {} } }])
        expect(readCount({ getItem: () => bad }, 'book-a', 'k1')).toBeNull()
    })

    it('does not throw when the browser refuses storage', () => {
        expect(() => writeCount({ getItem: () => null, setItem: () => { throw new Error('QuotaExceededError') } }, 'book-a', 'k1', COUNT)).not.toThrow()
    })
})
