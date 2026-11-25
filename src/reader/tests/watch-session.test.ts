import { describe, expect, it } from 'vitest'
import { watchSession } from '../src/start/watch-session'

const answering = (...statuses: number[]) => (() => Promise.resolve(new Response(null, { status: statuses.shift() ?? 200 }))) as unknown as typeof fetch

describe('watchSession', () => {
    it('tells of the first 401, to any request, once', async () => {
        let told = 0
        const session = watchSession(answering(200, 500, 401, 401))
        session.onEnded(() => { told++ })
        await session.fetch('/a')
        await session.fetch('/b')
        expect(told).toBe(0)
        expect((await session.fetch('/c')).status).toBe(401)
        await session.fetch('/d')
        expect(told).toBe(1)
    })

    it('tells at once of a 401 that came before anyone listened', async () => {
        let told = 0
        const session = watchSession(answering(401))
        await session.fetch('/a')
        session.onEnded(() => { told++ })
        expect(told).toBe(1)
    })

    it('passes the request, its answer and its failure through', async () => {
        const calls: unknown[][] = []
        const session = watchSession(((...args: unknown[]) => {
            calls.push(args)
            return Promise.reject(new TypeError('Load failed'))
        }))
        await expect(session.fetch('/a', { method: 'PUT' })).rejects.toThrow('Load failed')
        expect(calls).toEqual([['/a', { method: 'PUT' }]])
    })
})
