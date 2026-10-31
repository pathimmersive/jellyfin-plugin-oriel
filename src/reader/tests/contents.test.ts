import { describe, expect, it } from 'vitest'
import { contentsRows } from '../src/controls/contents'

// Sections start at these fractions of the book.
const starts: Record<string, number> = { 'ch1.xhtml': 0, 'ch2.xhtml': 0.25, 'ch3.xhtml': 0.5 }
const fractionOf = (href: string): number | null => starts[href.split('#')[0]] ?? null

const toc = [
    { label: 'Chapter One', href: 'ch1.xhtml' },
    { label: ' Chapter Two ', href: 'ch2.xhtml', subitems: [{ label: 'Part Two', href: 'ch2.xhtml#part', subitems: [{ label: 'Deeper', href: 'ch2.xhtml#deeper' }] }] },
    { label: 'Chapter Three', href: 'ch3.xhtml', subitems: null },
]

describe('contentsRows', () => {
    it('lists every entry in order, sub-entries one level deeper than their parent', () => {
        expect(contentsRows(toc, fractionOf, null).map(row => [row.label, row.depth])).toEqual([
            ['Chapter One', 0], ['Chapter Two', 0], ['Part Two', 1], ['Deeper', 2], ['Chapter Three', 0],
        ])
    })

    it('gives each entry the percent of the book where its section starts', () => {
        expect(contentsRows(toc, fractionOf, null).map(row => row.percent)).toEqual(['0%', '25%', '25%', '25%', '50%'])
    })

    it('marks the entry being read, and only that one', () => {
        expect(contentsRows(toc, fractionOf, 'ch2.xhtml#part').filter(row => row.current).map(row => row.label)).toEqual(['Part Two'])
        expect(contentsRows(toc, fractionOf, null).some(row => row.current)).toBe(false)
    })

    it('keeps an entry with no link or no known place, without a percent', () => {
        const rows = contentsRows([{ label: 'Part One' }, { label: 'Elsewhere', href: 'notes.xhtml' }], fractionOf, null)
        expect(rows.map(row => [row.label, row.href, row.percent])).toEqual([['Part One', '', ''], ['Elsewhere', 'notes.xhtml', '']])
    })

    it('gives nothing for a book with no contents', () => {
        expect(contentsRows([], fractionOf, null)).toEqual([])
    })
})
