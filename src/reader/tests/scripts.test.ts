import { describe, expect, it } from 'vitest'
import { isOpenableLink, isScriptUrl, stripSections } from '../src/engine/scripts'

describe('isScriptUrl', () => {
    it('knows a javascript: URL however it is written', () => {
        expect(isScriptUrl('javascript:alert(1)')).toBe(true)
        expect(isScriptUrl('  JavaScript:alert(1)')).toBe(true)
        expect(isScriptUrl('java\tscript:alert(1)')).toBe(true)
        expect(isScriptUrl('\u0001javascript:void 0')).toBe(true)
    })

    it('leaves every other link alone', () => {
        expect(isScriptUrl('chapter2.xhtml#note')).toBe(false)
        expect(isScriptUrl('blob:http://localhost/0a1b')).toBe(false)
        expect(isScriptUrl('https://example.org/javascript:')).toBe(false)
        expect(isScriptUrl('')).toBe(false)
    })
})

describe('isOpenableLink', () => {
    it('opens web and mail addresses', () => {
        expect(isOpenableLink('https://example.org/a')).toBe(true)
        expect(isOpenableLink(' HTTP://example.org')).toBe(true)
        expect(isOpenableLink('mailto:author@example.org')).toBe(true)
    })

    it('opens nothing else a book may link to', () => {
        expect(isOpenableLink('javascript:alert(1)')).toBe(false)
        expect(isOpenableLink('ms-settings:')).toBe(false)
        expect(isOpenableLink('file:///etc/passwd')).toBe(false)
        expect(isOpenableLink('data:text/html,<p>x</p>')).toBe(false)
        expect(isOpenableLink('https:example.org')).toBe(false)
    })
})

describe('stripSections', () => {
    // A stand-in document that records what stripScripts asks of it.
    const recording = () => {
        const asked: string[] = []
        const doc = { querySelectorAll: (selector: string) => { asked.push(selector); return [] } } as unknown as Document
        return { doc, asked }
    }

    it('strips each section of a book without a transformTarget as the book parses it', async () => {
        const { doc, asked } = recording()
        const book = { createDocument: async (section: unknown) => (section === 7 ? doc : null) as Document }
        stripSections(book)
        expect(await book.createDocument(7)).toBe(doc)
        expect(asked).toContain('script')
    })

    it('leaves a book with a transformTarget to its data event', async () => {
        const { doc, asked } = recording()
        const createDocument = async () => doc
        const book = { transformTarget: new EventTarget(), createDocument }
        stripSections(book)
        expect(book.createDocument).toBe(createDocument)
        await book.createDocument()
        expect(asked).toEqual([])
    })
})
