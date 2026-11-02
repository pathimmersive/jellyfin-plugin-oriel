import { describe, expect, it } from 'vitest'
import { noMatches } from '../src/controls/search'

describe('noMatches', () => {
    it('says what was searched for, in curly quotes', () => {
        expect(noMatches('Netherfeild')).toBe('No matches for “Netherfeild” in this book.')
    })
})
