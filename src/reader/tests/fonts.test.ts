import { describe, expect, it } from 'vitest'
import { addFont, type OwnFont } from '../src/api/client'
import { createOwnFonts, familiesOf, MAX_FONT_BYTES, type OwnFontSources, refusalMessage, stylesOf } from '../src/controls/fonts'
import { bookStyles, fontStack, ownFamilyOf, ownFont, ownFontFace, readSettings } from '../src/settings/settings'

const font = (id: string, family: string, style: string, weight = 400, italic = false, format: OwnFont['format'] = 'ttf'): OwnFont =>
    ({ id, family, style, weight, italic, format })

const CHARTER = [font('a', 'Charter', 'Regular'), font('b', 'Charter', 'Italic', 400, true, 'woff2'), font('c', 'Charter', 'Bold', 700)]

// A server keeping `stored`, with a URL per file the fonts are given.
const sources = (stored: OwnFont[], overrides: Partial<OwnFontSources> = {}) => {
    const server = [...stored]
    const forgotten: string[] = []
    let next = 1
    const result: OwnFontSources & { server: OwnFont[], forgotten: string[] } = {
        server,
        forgotten,
        load: async () => [...server],
        add: async () => {
            const added = font(`n${next++}`, 'Charter', 'Regular')
            server.splice(server.findIndex(each => each.family === added.family && each.weight === added.weight && each.italic === added.italic) >>> 0, 1)
            server.push(added)
            return added
        },
        file: async id => new Blob([id]),
        remove: async family => {
            for (let at = server.length - 1; at >= 0; at--) if (server[at].family === family) server.splice(at, 1)
            return true
        },
        url: blob => `blob:${blob.size}:${next++}`,
        forget: url => { forgotten.push(url) },
        ...overrides,
    }
    return result
}

const file = (name: string, size = 10): File => new File([new Uint8Array(size)], name)

describe('familiesOf and stylesOf', () => {
    it('groups the files by family in the server\'s order and lists each family\'s styles', () => {
        const families = familiesOf([...CHARTER, font('d', 'Zapf', 'Regular')])
        expect(families.map(family => family.name)).toEqual(['Charter', 'Zapf'])
        expect(stylesOf(families[0])).toBe('Regular, Italic, Bold')
    })
})

describe('refusalMessage', () => {
    it('says why a file was not added', () => {
        expect(refusalMessage('tooLarge', 'big.ttf')).toBe('big.ttf is larger than 5 MB.')
        expect(refusalMessage('notAFont', 'notes.txt')).toBe('notes.txt is not a TTF, OTF or WOFF2 font.')
        expect(refusalMessage('tooMany', 'one.ttf')).toBe('You already have 20 font files. Remove a font to add another.')
        expect(refusalMessage('failed', 'one.ttf')).toBe('one.ttf could not be added. Try again.')
    })
})

describe('own font choices', () => {
    it('names an own family apart from the bundled and installed fonts, quoting what CSS would break on', () => {
        expect(ownFont('Charter')).toBe('own:Charter')
        expect(ownFamilyOf('own:Charter')).toBe('Charter')
        expect(ownFamilyOf('Literata')).toBeNull()
        expect(fontStack('own:Charter')).toBe("'Oriel own: Charter', Georgia, serif")
        expect(fontStack("own:It's\\")).toBe("'Oriel own: It\\27 s\\5c ', Georgia, serif")
        expect(fontStack('Literata')).toBe("'Literata', Georgia, serif")
    })

    it('declares a file as its family, weight and style, from its URL', () => {
        expect(ownFontFace(font('b', 'Charter', 'Italic', 400, true, 'woff2'), 'blob:x')).toBe(
            "@font-face { font-family: 'Oriel own: Charter'; font-style: italic; font-weight: 400; font-display: swap; src: url('blob:x') format('woff2'); }")
        expect(ownFontFace(font('a', 'Charter', 'Bold', 700), 'blob:y')).toContain("font-style: normal; font-weight: 700; font-display: swap; src: url('blob:y') format('truetype')")
    })

    it('keeps an own family as the chosen font and sets it over the book\'s', () => {
        const storage = { getItem: () => JSON.stringify({ font: 'own:Charter' }) }
        const settings = readSettings(storage)
        expect(settings.font).toBe('own:Charter')
        expect(bookStyles(settings, '')).toContain("font-family: 'Oriel own: Charter', Georgia, serif !important")
        expect(readSettings({ getItem: () => JSON.stringify({ font: 'own:' }) }).font).toBe('Default')
        expect(readSettings({ getItem: () => JSON.stringify({ font: 'Comic Sans' }) }).font).toBe('Default')
    })
})

describe('createOwnFonts', () => {
    it('loads the files and declares each from a URL of its own', async () => {
        const fonts = createOwnFonts(sources(CHARTER))
        let changes = 0
        fonts.onChange(() => changes++)
        expect(await fonts.ready).toBe(true)
        expect(changes).toBe(1)
        expect(fonts.families().map(family => family.name)).toEqual(['Charter'])
        expect(fonts.has('Charter')).toBe(true)
        expect(fonts.faces().split('\n')).toHaveLength(3)
        expect(fonts.faces()).toContain("font-style: italic; font-weight: 400")
    })

    it('says when the list could not be read, and leaves out a file that could not', async () => {
        expect(await createOwnFonts(sources(CHARTER, { load: async () => null })).ready).toBe(false)
        const fonts = createOwnFonts(sources(CHARTER, { file: async id => id === 'b' ? null : new Blob([id]) }))
        await fonts.ready
        expect(fonts.faces().split('\n')).toHaveLength(2)
        expect(fonts.faces()).not.toContain('italic;')
    })

    it('adds a file, replacing the style the family had, from the file itself', async () => {
        const from = sources(CHARTER)
        const fonts = createOwnFonts(from)
        await fonts.ready
        expect(await fonts.add(file('charter.ttf'))).toBeNull()
        expect(fonts.families()[0].fonts.map(each => each.id)).toEqual(['n4', 'b', 'c'])
        expect(from.forgotten).toHaveLength(1)
    })

    it('refuses a file over 5 MB without sending it, and says what the server refused', async () => {
        let sent = 0
        const fonts = createOwnFonts(sources([], { add: async () => { sent++; return 'notAFont' } }))
        await fonts.ready
        expect(await fonts.add(file('big.ttf', MAX_FONT_BYTES + 1))).toBe('big.ttf is larger than 5 MB.')
        expect(sent).toBe(0)
        expect(await fonts.add(file('notes.txt'))).toBe('notes.txt is not a TTF, OTF or WOFF2 font.')
        expect(fonts.families()).toEqual([])
    })

    it('removes a family and forgets its URLs, and keeps it when the server could not', async () => {
        const from = sources([...CHARTER, font('d', 'Zapf', 'Regular')])
        const fonts = createOwnFonts(from)
        await fonts.ready
        expect(await fonts.remove('Charter')).toBe(true)
        expect(fonts.families().map(family => family.name)).toEqual(['Zapf'])
        expect(from.forgotten).toHaveLength(3)

        const failing = createOwnFonts(sources(CHARTER, { remove: async () => false }))
        await failing.ready
        expect(await failing.remove('Charter')).toBe(false)
        expect(failing.has('Charter')).toBe(true)
    })
})

describe('addFont', () => {
    const answer = (status: number, body: unknown): typeof fetch => async () => new Response(body === null ? null : JSON.stringify(body), { status })

    it('gives the font kept, or why the server refused it', async () => {
        const kept = font('a', 'Charter', 'Regular')
        expect(await addFont('', 'auth', new Blob(['x']), answer(200, kept))).toEqual(kept)
        expect(await addFont('', 'auth', new Blob(['x']), answer(413, null))).toBe('tooLarge')
        expect(await addFont('', 'auth', new Blob(['x']), answer(400, { reason: 'notAFont' }))).toBe('notAFont')
        expect(await addFont('', 'auth', new Blob(['x']), answer(400, { reason: 'tooMany' }))).toBe('tooMany')
        expect(await addFont('', 'auth', new Blob(['x']), answer(500, null))).toBe('failed')
        expect(await addFont('', 'auth', new Blob(['x']), async () => { throw new TypeError('offline') })).toBe('failed')
    })
})
