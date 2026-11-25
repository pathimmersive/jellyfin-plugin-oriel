import { describe, expect, it } from 'vitest'
import { type FoliateFound, noMatches, type SearchSection, sectionsOf } from '../src/controls/search'

describe('noMatches', () => {
    it('says what was searched for, in curly quotes', () => {
        expect(noMatches('Netherfeild')).toBe('No matches for “Netherfeild” in this book.')
    })
})

describe('sectionsOf', () => {
    // A foliate-js search over three sections, the first two without matches; counts what it searched.
    const book = () => {
        const searched = { sections: 0 }
        // eslint-disable-next-line @typescript-eslint/require-await -- foliate-js's search is an async generator; this one has nothing to wait for
        async function* found(): AsyncGenerator<FoliateFound> {
            for (let index = 0; index < 3; index++) {
                searched.sections++
                yield { progress: (index + 1) / 3 }
                if (index === 2) yield { label: ' Chapter Three ', subitems: [{ cfi: 'epubcfi(/6/8!/4/2/1:0)', excerpt: { pre: 'a ', match: 'lantern', post: ' lit' } }] }
            }
            yield 'done'
        }
        return { searched, found }
    }

    it('gives every section searched, then its matches named by their chapter', async () => {
        const { found } = book()
        const sections: SearchSection[] = []
        for await (const section of sectionsOf(found())) sections.push(section)
        expect(sections).toEqual([
            { label: '', matches: [] },
            { label: '', matches: [] },
            { label: '', matches: [] },
            { label: 'Chapter Three', matches: [{ cfi: 'epubcfi(/6/8!/4/2/1:0)', pre: 'a ', match: 'lantern', post: ' lit' }] },
        ])
    })

    it('stops searching at the next section once the reader stops reading it', async () => {
        const { searched, found } = book()
        for await (const section of sectionsOf(found())) {
            expect(section.matches).toEqual([])
            break
        }
        expect(searched.sections).toBe(1)
    })
})
