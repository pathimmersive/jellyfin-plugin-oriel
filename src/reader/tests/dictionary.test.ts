import { describe, expect, it } from 'vitest'
import { lookUpWord } from '../src/api/client'
import { definable } from '../src/controls/dictionary'

const respond = (status: number, body: unknown = null) => {
    const calls: { url: string, init?: RequestInit }[] = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
        calls.push({ url, init })
        return new Response(status === 200 ? JSON.stringify(body) : null, { status })
    }) as typeof fetch
    return { fetchImpl, calls }
}

describe('definable', () => {
    it('takes one to three words', () => {
        expect(definable('universally')).toBe(true)
        expect(definable('  in vain ')).toBe(true)
        expect(definable('a truth universally')).toBe(true)
        expect(definable('a truth universally acknowledged')).toBe(false)
        expect(definable('   ')).toBe(false)
    })

    it('takes no more than 64 characters', () => {
        expect(definable('a'.repeat(64))).toBe(true)
        expect(definable('a'.repeat(65))).toBe(false)
    })
})

describe('lookUpWord', () => {
    const found = { word: 'acknowledge', entries: [{ word: 'acknowledge', partOfSpeech: 'verb', senses: ['Declare to be true or admit the existence or reality or truth of.'] }] }

    it('asks /Oriel/Dictionary under the base path for the word, URL-encoded, with the Authorization header', async () => {
        const { fetchImpl, calls } = respond(200, found)

        expect(await lookUpWord('/jf', 'MediaBrowser Token="t"', 'in vain', fetchImpl)).toEqual({ found })
        expect(calls[0].url).toBe('/jf/Oriel/Dictionary?word=in%20vain')
        expect(calls[0].init?.headers).toEqual({ Authorization: 'MediaBrowser Token="t"' })
    })

    it('tells a word the dictionary does not hold from a failure to ask', async () => {
        expect(await lookUpWord('', 'h', 'qwxzt', respond(404).fetchImpl)).toEqual({ missing: true })
        expect(await lookUpWord('', 'h', 'word', respond(500).fetchImpl)).toEqual({ failed: true })
        expect(await lookUpWord('', 'h', 'word', respond(200, { word: 'word' }).fetchImpl)).toEqual({ failed: true })
        expect(await lookUpWord('', 'h', 'word', (async () => { throw new TypeError('offline') }) as typeof fetch)).toEqual({ failed: true })
    })
})
