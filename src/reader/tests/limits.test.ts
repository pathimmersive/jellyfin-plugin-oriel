import { describe, expect, it } from 'vitest'
import { addBookmark, addHighlight, updateHighlight } from '../src/api/client'

const answer = (status: number, body: unknown): typeof fetch => async () => new Response(JSON.stringify(body), { status })

describe('the limits on bookmarks and highlights', () => {
    it('reports a bookmark or highlight past the limit as limitReached', async () => {
        expect(await addBookmark('', 'item', 'auth', 'epubcfi(/6/2)', 0.5, 'text', answer(409, { reason: 'limitReached' }))).toBe('limitReached')
        expect(await addHighlight('', 'item', 'auth', 'epubcfi(/6/2)', 0.5, 'yellow', 'text', '', answer(409, { reason: 'limitReached' }))).toBe('limitReached')
    })

    it('treats any other refusal as a failure', async () => {
        expect(await addBookmark('', 'item', 'auth', 'epubcfi(/6/2)', 0.5, 'text', answer(409, { reason: 'other' }))).toBeNull()
        expect(await addBookmark('', 'item', 'auth', 'epubcfi(/6/2)', 0.5, 'text', answer(500, null))).toBeNull()
        expect(await updateHighlight('', 'item', 'auth', 'id', { note: 'n' }, answer(409, { reason: 'limitReached' }))).toBeNull()
    })
})
