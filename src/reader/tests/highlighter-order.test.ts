import { describe, expect, it } from 'vitest'
import { dropTarget, keyTarget, reordered, without } from '../src/controls/highlighter-order'
import type { Highlighter } from '../src/controls/highlighters'

const LIST: Highlighter[] = ['a', 'b', 'c', 'd'].map(id => ({ id, name: id.toUpperCase(), solid: `#00000${id}`, fill: 0.5, builtIn: false, uses: 3 }))
const edit = (id: string) => ({ id, name: id.toUpperCase(), colour: `#00000${id}` })

describe('keyTarget', () => {
    it('moves one place with the up and down arrows', () => {
        expect(keyTarget('ArrowUp', 2, 4)).toBe(1)
        expect(keyTarget('ArrowDown', 2, 4)).toBe(3)
    })

    it('goes past neither end', () => {
        expect(keyTarget('ArrowUp', 0, 4)).toBeNull()
        expect(keyTarget('ArrowDown', 3, 4)).toBeNull()
    })

    it('is not moved by another key', () => {
        expect(keyTarget('ArrowLeft', 2, 4)).toBeNull()
        expect(keyTarget('Enter', 2, 4)).toBeNull()
    })
})

describe('dropTarget', () => {
    // The middles of the three rows that stay, as one of four is dragged.
    const middles = [120, 160, 200]

    it('lands before the first row whose middle is below the pointer', () => {
        expect(dropTarget(middles, 100)).toBe(0)
        expect(dropTarget(middles, 130)).toBe(1)
        expect(dropTarget(middles, 199)).toBe(2)
        expect(dropTarget(middles, 400)).toBe(3)
    })

    it('stays before a row whose middle the pointer is exactly on', () => {
        expect(dropTarget(middles, 160)).toBe(1)
    })
})

describe('reordered', () => {
    it('gives the whole list to keep, with the one moved in its new place', () => {
        expect(reordered(LIST, 0, 2)).toEqual([edit('b'), edit('c'), edit('a'), edit('d')])
        expect(reordered(LIST, 3, 0)).toEqual([edit('d'), edit('a'), edit('b'), edit('c')])
    })

    it('has nothing to keep when the one moved is where it was', () => {
        expect(reordered(LIST, 1, 1)).toBeNull()
    })
})

describe('without', () => {
    it('gives the whole list to keep without the one deleted', () => {
        expect(without(LIST, 'b')).toEqual([edit('a'), edit('c'), edit('d')])
    })
})
