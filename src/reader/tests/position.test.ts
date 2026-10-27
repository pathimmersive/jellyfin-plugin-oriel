import { describe, expect, it, vi } from 'vitest'
import { readPositionTicks, writePositionTicks } from '../src/api/client'
import { fractionFromTicks, positionWriter, ticksFromFraction } from '../src/position/position'

describe('ticks and fractions', () => {
    it('reads a saved position as a fraction of the book', () => {
        expect(fractionFromTicks(6_000_000)).toBe(0.6)
        expect(fractionFromTicks(10_000_000)).toBe(1)
        expect(fractionFromTicks(25_000_000)).toBe(1)
    })

    it('opens at the start when nothing is saved', () => {
        expect(fractionFromTicks(null)).toBeNull()
        expect(fractionFromTicks(0)).toBeNull()
        expect(fractionFromTicks(-5)).toBeNull()
        expect(fractionFromTicks(Number.NaN)).toBeNull()
    })

    it('writes a fraction as whole ticks within the book', () => {
        expect(ticksFromFraction(0.61234567)).toBe(6_123_457)
        expect(ticksFromFraction(1.2)).toBe(10_000_000)
        expect(ticksFromFraction(-0.1)).toBe(0)
    })
})

describe('positionWriter', () => {
    const setup = (openedAt: number | null, ok = true) => {
        vi.useFakeTimers()
        const write = vi.fn(async (_ticks: number, _keepalive: boolean) => ok)
        return { write, writer: positionWriter(write, openedAt, 5000) }
    }

    it('writes once, five seconds after the last move', async () => {
        const { write, writer } = setup(6_000_000)
        writer.moved(0.61)
        await vi.advanceTimersByTimeAsync(3000)
        writer.moved(0.62)
        await vi.advanceTimersByTimeAsync(4999)
        expect(write).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(1)
        expect(write).toHaveBeenCalledTimes(1)
        expect(write).toHaveBeenCalledWith(6_200_000, false)
        vi.useRealTimers()
    })

    it('writes nothing for the position the book was opened at', async () => {
        const { write, writer } = setup(6_000_000)
        writer.moved(0.6)
        await vi.advanceTimersByTimeAsync(6000)
        writer.flush()
        expect(write).not.toHaveBeenCalled()
        vi.useRealTimers()
    })

    it('writes a pending position at once on flush, with keepalive', async () => {
        const { write, writer } = setup(null)
        writer.moved(0.3)
        writer.flush()
        expect(write).toHaveBeenCalledWith(3_000_000, true)
        await vi.advanceTimersByTimeAsync(6000)
        expect(write).toHaveBeenCalledTimes(1)
        vi.useRealTimers()
    })

    it('tries the same position again after a failed write', async () => {
        const { write, writer } = setup(null, false)
        writer.moved(0.3)
        await vi.advanceTimersByTimeAsync(5000)
        writer.moved(0.3)
        await vi.advanceTimersByTimeAsync(5000)
        expect(write).toHaveBeenCalledTimes(2)
        vi.useRealTimers()
    })
})

describe('user data requests', () => {
    it('reads the saved ticks with the session', async () => {
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ PlaybackPositionTicks: 6_000_000 }))) as unknown as typeof fetch
        expect(await readPositionTicks('/jf', 'abc', 'user1', 'auth', fetchImpl)).toBe(6_000_000)
        expect(fetchImpl).toHaveBeenCalledWith('/jf/UserItems/abc/UserData?userId=user1', { headers: { Authorization: 'auth' } })
    })

    it('reads null when the request fails', async () => {
        const failing = vi.fn(async () => { throw new TypeError('offline') }) as unknown as typeof fetch
        const refused = vi.fn(async () => new Response('', { status: 401 })) as unknown as typeof fetch
        expect(await readPositionTicks('', 'abc', 'u', 'a', failing)).toBeNull()
        expect(await readPositionTicks('', 'abc', 'u', 'a', refused)).toBeNull()
    })

    it('writes only the ticks and reports whether the server took them', async () => {
        const fetchImpl = vi.fn(async () => new Response('{}')) as unknown as typeof fetch
        expect(await writePositionTicks('', 'abc', 'user1', 'auth', 6_200_000, true, fetchImpl)).toBe(true)
        expect(fetchImpl).toHaveBeenCalledWith('/UserItems/abc/UserData?userId=user1', {
            method: 'POST',
            headers: { Authorization: 'auth', 'Content-Type': 'application/json' },
            body: JSON.stringify({ PlaybackPositionTicks: 6_200_000 }),
            keepalive: true,
        })
        const failing = vi.fn(async () => { throw new TypeError('offline') }) as unknown as typeof fetch
        expect(await writePositionTicks('', 'abc', 'u', 'a', 1, false, failing)).toBe(false)
    })
})
