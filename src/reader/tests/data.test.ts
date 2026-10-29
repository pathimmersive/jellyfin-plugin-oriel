import { describe, expect, it } from 'vitest'
import { attachmentName, downloadReadingData, importReadingData } from '../src/api/client'
import { backHref, bookId, isImportResult, summarizeImport } from '../src/data/summary'
import { RETURN_KEY, saveDataReturnMarker } from '../src/session/return'

const ITEM = '3d180653ee958ef40e0ea24db3142dea'

describe('summarizeImport', () => {
    it('reports places imported, places kept and unmatched books', () => {
        const summary = summarizeImport({
            imported: 12,
            kept: 3,
            unmatched: [
                { title: 'Emma', authors: ['Jane Austen'], fileName: 'emma.epub' },
                { title: 'Persuasion', authors: ['Jane Austen'], fileName: 'persuasion.epub' },
            ],
        })
        expect(summary.imported).toBe('12 places imported')
        expect(summary.kept).toBe('3 kept as they were, because you had read further on this server')
        expect(summary.unmatchedLead).toBe('2 books are not in your library here, so their places were not imported:')
        expect(summary.unmatched).toEqual([
            { title: 'Emma', detail: 'Jane Austen · emma.epub' },
            { title: 'Persuasion', detail: 'Jane Austen · persuasion.epub' },
        ])
    })

    it('speaks of one place, one kept and one book in the singular', () => {
        const summary = summarizeImport({ imported: 1, kept: 1, unmatched: [{ title: 'Emma', authors: [], fileName: null }] })
        expect(summary.imported).toBe('1 place imported')
        expect(summary.kept).toBe('1 kept as it was, because you had read further on this server')
        expect(summary.unmatchedLead).toBe('1 book is not in your library here, so its place was not imported:')
        expect(summary.unmatched).toEqual([{ title: 'Emma', detail: '' }])
    })

    it('leaves out the lines with nothing to report', () => {
        expect(summarizeImport({ imported: 0, kept: 0, unmatched: [] }))
            .toEqual({ imported: null, kept: null, unmatchedLead: null, unmatched: [] })
    })

    it('names an unmatched book with no title by its file name, and joins several authors', () => {
        const summary = summarizeImport({ imported: 0, kept: 0, unmatched: [{ title: null, authors: ['A', 'B'], fileName: 'x.epub' }] })
        expect(summary.unmatched).toEqual([{ title: 'x.epub', detail: 'A, B · x.epub' }])
    })
})

describe('isImportResult', () => {
    it('accepts what /Oriel/Import returns and nothing else', () => {
        expect(isImportResult({ imported: 0, kept: 1, unmatched: [] })).toBe(true)
        expect(isImportResult({ imported: 0, kept: 1, unmatched: [{ title: 'x', authors: [], fileName: null }] })).toBe(true)
        expect(isImportResult({ imported: '0', kept: 1, unmatched: [] })).toBe(false)
        expect(isImportResult({ imported: 0, kept: 1, unmatched: [{ title: 'x' }] })).toBe(false)
        expect(isImportResult(null)).toBe(false)
    })
})

describe('the back link', () => {
    it('returns to the book the page was opened for, under any BaseUrl', () => {
        expect(backHref('', bookId(`?id=${ITEM}`))).toBe(`/Oriel/?id=${ITEM}`)
        expect(backHref('/jf', bookId(`?id=${ITEM}`))).toBe(`/jf/Oriel/?id=${ITEM}`)
    })

    it('returns to the Jellyfin home page without a book, or with an id that is not an item id', () => {
        expect(backHref('', bookId(''))).toBe('/web/')
        expect(backHref('/jf', bookId('?id=../x'))).toBe('/jf/web/')
    })
})

describe('attachmentName', () => {
    it('reads the file name ASP.NET Core sends', () => {
        expect(attachmentName("attachment; filename=oriel-reading-data-2026-10-29.json; filename*=UTF-8''oriel-reading-data-2026-10-29.json"))
            .toBe('oriel-reading-data-2026-10-29.json')
        expect(attachmentName('attachment; filename="a b.json"')).toBe('a b.json')
        expect(attachmentName(null)).toBeNull()
    })
})

const respond = (status: number, body: unknown, headers: Record<string, string> = {}): typeof fetch =>
    (async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers })) as typeof fetch

describe('downloadReadingData', () => {
    it('returns the file under the name the server gives it', async () => {
        const file = await downloadReadingData('', 'auth', respond(200, '{"format":"oriel-reading-data"}', {
            'Content-Disposition': 'attachment; filename=oriel-reading-data-2026-10-29.json',
        }))
        expect(file.ok && file.fileName).toBe('oriel-reading-data-2026-10-29.json')
        expect(file.ok && await file.blob.text()).toBe('{"format":"oriel-reading-data"}')
    })

    it('says why it could not', async () => {
        expect(await downloadReadingData('', 'auth', respond(401, ''))).toEqual({ ok: false, reason: 'HTTP 401' })
    })
})

describe('importReadingData', () => {
    const file = new Blob(['{}'])

    it('returns the server result', async () => {
        const outcome = await importReadingData('', 'auth', file, respond(200, { imported: 1, kept: 0, unmatched: [] }))
        expect(outcome).toEqual({ kind: 'done', result: { imported: 1, kept: 0, unmatched: [] } })
    })

    it('reports a file the server rejects', async () => {
        expect(await importReadingData('', 'auth', file, respond(400, ''))).toEqual({ kind: 'rejected' })
    })

    it('reports other failures and unexpected replies', async () => {
        expect(await importReadingData('', 'auth', file, respond(500, ''))).toEqual({ kind: 'failed', reason: 'HTTP 500' })
        expect(await importReadingData('', 'auth', file, respond(200, { ok: true }))).toEqual({ kind: 'failed', reason: 'an unexpected reply' })
    })
})

describe('saveDataReturnMarker', () => {
    const storage = () => {
        const map = new Map<string, string>()
        return { setItem: (key: string, value: string) => { map.set(key, value) }, map }
    }

    it('names the data page and the book it was opened for', () => {
        const s = storage()
        expect(saveDataReturnMarker(s, ITEM, 1000)).toBe(true)
        expect(JSON.parse(s.map.get(RETURN_KEY)!)).toEqual({ page: 'data', id: ITEM, at: 1000 })
    })

    it('leaves out an id that is missing or not an item id', () => {
        for (const id of [null, '../x']) {
            const s = storage()
            saveDataReturnMarker(s, id, 1000)
            expect(JSON.parse(s.map.get(RETURN_KEY)!)).toEqual({ page: 'data', at: 1000 })
        }
    })
})
