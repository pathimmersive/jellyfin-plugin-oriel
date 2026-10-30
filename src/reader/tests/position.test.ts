import { describe, expect, it, vi } from 'vitest'
import { readJellyfinPosition, readStoredPosition, writeJellyfinPosition, writeStoredPosition } from '../src/api/client'
import type { JellyfinPosition, StoredPosition } from '../src/api/client'
import { chooseStart, fallbackStart, fractionFromTicks, missingPlaceNotice, positionWriter, saveBoth, ticksFromFraction } from '../src/position/position'

const CFI = 'epubcfi(/6/8!/4/2/1:0)'
const stored = (savedAt: string) => ({ cfi: CFI, fraction: 0.6, savedAt })
const jellyfin = (ticks: number | null, lastPlayed: string | null) => ({ ticks, lastPlayed })

describe('ticks and fractions', () => {
    it('reads a saved position as a fraction of the book', () => {
        expect(fractionFromTicks(6_000_000)).toBe(0.6)
        expect(fractionFromTicks(25_000_000)).toBe(1)
    })

    it('opens at the start when nothing is saved', () => {
        expect(fractionFromTicks(null)).toBeNull()
        expect(fractionFromTicks(0)).toBeNull()
        expect(fractionFromTicks(Number.NaN)).toBeNull()
    })

    it('writes a fraction as whole ticks within the book', () => {
        expect(ticksFromFraction(0.61234567)).toBe(6_123_457)
        expect(ticksFromFraction(1.2)).toBe(10_000_000)
        expect(ticksFromFraction(-0.1)).toBe(0)
    })
})

describe('chooseStart', () => {
    it('opens at the stored exact position when it was saved last', () => {
        expect(chooseStart(stored('2026-10-27T10:00:00Z'), jellyfin(2_500_000, '2026-10-27T09:00:00Z'))).toEqual({ cfi: CFI })
        expect(chooseStart(stored('2026-10-27T10:00:00Z'), jellyfin(2_500_000, '2026-10-27T10:00:00Z'))).toEqual({ cfi: CFI })
    })

    it("opens at Jellyfin's position when it was saved after the stored one", () => {
        expect(chooseStart(stored('2026-10-27T10:00:00Z'), jellyfin(2_500_000, '2026-10-27T10:00:01Z'))).toEqual({ fraction: 0.25 })
    })

    it("opens at the start when Jellyfin's later position is the start", () => {
        expect(chooseStart(stored('2026-10-27T10:00:00Z'), jellyfin(0, '2026-10-27T11:00:00Z'))).toBeNull()
    })

    it('uses whichever position exists, and the start when neither does', () => {
        expect(chooseStart(stored('2026-10-27T10:00:00Z'), null)).toEqual({ cfi: CFI })
        expect(chooseStart(stored('2026-10-27T10:00:00Z'), jellyfin(null, null))).toEqual({ cfi: CFI })
        expect(chooseStart(null, jellyfin(2_500_000, null))).toEqual({ fraction: 0.25 })
        expect(chooseStart(null, null)).toBeNull()
    })

    it('treats a missing or unreadable Jellyfin time as older than the stored position', () => {
        expect(chooseStart(stored('2026-10-27T10:00:00Z'), jellyfin(2_500_000, 'not a date'))).toEqual({ cfi: CFI })
    })
})

describe('positionWriter', () => {
    const moved = (cfi: string, fraction = 0.6) => ({ cfi, fraction })
    const setup = (openedAt: string | null, ok = true) => {
        vi.useFakeTimers()
        const save = vi.fn(async (_position: { cfi: string, fraction: number }, _keepalive: boolean) => ok)
        return { save, writer: positionWriter(save, openedAt, 5000) }
    }

    it('saves once, five seconds after the last move', async () => {
        const { save, writer } = setup(CFI)
        writer.moved(moved('epubcfi(/6/8!/4/2/3:0)', 0.61))
        await vi.advanceTimersByTimeAsync(3000)
        writer.moved(moved('epubcfi(/6/8!/4/2/5:0)', 0.62))
        await vi.advanceTimersByTimeAsync(4999)
        expect(save).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(1)
        expect(save).toHaveBeenCalledTimes(1)
        expect(save).toHaveBeenCalledWith(moved('epubcfi(/6/8!/4/2/5:0)', 0.62), false)
        vi.useRealTimers()
    })

    it('saves nothing for the position the book was opened at', async () => {
        const { save, writer } = setup(CFI)
        writer.moved(moved(CFI))
        await vi.advanceTimersByTimeAsync(6000)
        writer.flush()
        expect(save).not.toHaveBeenCalled()
        vi.useRealTimers()
    })

    it('saves a pending position at once on flush, with keepalive', async () => {
        const { save, writer } = setup(null)
        writer.moved(moved(CFI, 0.3))
        writer.flush()
        expect(save).toHaveBeenCalledWith(moved(CFI, 0.3), true)
        await vi.advanceTimersByTimeAsync(6000)
        expect(save).toHaveBeenCalledTimes(1)
        vi.useRealTimers()
    })

    it('tries the same position again after a failed save', async () => {
        const { save, writer } = setup(null, false)
        writer.moved(moved(CFI))
        await vi.advanceTimersByTimeAsync(5000)
        writer.moved(moved(CFI))
        await vi.advanceTimersByTimeAsync(5000)
        expect(save).toHaveBeenCalledTimes(2)
        vi.useRealTimers()
    })
})

describe('saveBoth', () => {
    it("stamps Jellyfin's copy with the store's time, not the device clock", async () => {
        const writeStored = vi.fn(async () => stored('2026-10-27T10:00:00.000Z'))
        const writeJellyfin = vi.fn(async () => true)
        const ok = await saveBoth({ cfi: CFI, fraction: 0.6 }, false, writeStored, writeJellyfin, () => new Date('2030-01-01T00:00:00Z'))
        expect(ok).toBe(true)
        expect(writeStored).toHaveBeenCalledWith(CFI, 0.6, false)
        expect(writeJellyfin).toHaveBeenCalledWith(6_000_000, '2026-10-27T10:00:00.000Z', false)
    })

    it("stamps Jellyfin's copy with the current time when the store cannot be written, so it wins next time", async () => {
        const writeJellyfin = vi.fn(async () => true)
        const ok = await saveBoth({ cfi: CFI, fraction: 0.6 }, true, async () => null, writeJellyfin, () => new Date('2026-10-27T10:00:05.000Z'))
        expect(ok).toBe(false)
        expect(writeJellyfin).toHaveBeenCalledWith(6_000_000, '2026-10-27T10:00:05.000Z', true)
    })
})

describe('position requests', () => {
    const json = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
    const failing = vi.fn(async () => { throw new TypeError('offline') }) as unknown as typeof fetch

    it("reads Jellyfin's ticks and save time with the session", async () => {
        const fetchImpl = json({ PlaybackPositionTicks: 6_000_000, LastPlayedDate: '2026-10-27T10:00:00Z' })
        expect(await readJellyfinPosition('/jf', 'abc', 'user1', 'auth', fetchImpl)).toEqual(jellyfin(6_000_000, '2026-10-27T10:00:00Z'))
        expect(fetchImpl).toHaveBeenCalledWith('/jf/UserItems/abc/UserData?userId=user1', { headers: { Authorization: 'auth' } })
        expect(await readJellyfinPosition('', 'abc', 'u', 'a', failing)).toBeNull()
    })

    it("writes Jellyfin's ticks with the given save time", async () => {
        const fetchImpl = json({})
        expect(await writeJellyfinPosition('', 'abc', 'user1', 'auth', 6_200_000, '2026-10-27T10:00:00Z', true, fetchImpl)).toBe(true)
        expect(fetchImpl).toHaveBeenCalledWith('/UserItems/abc/UserData?userId=user1', {
            method: 'POST',
            headers: { Authorization: 'auth', 'Content-Type': 'application/json' },
            body: JSON.stringify({ PlaybackPositionTicks: 6_200_000, LastPlayedDate: '2026-10-27T10:00:00Z' }),
            keepalive: true,
        })
    })

    it('reads the stored position, and null when there is none, it is malformed or the request fails', async () => {
        expect(await readStoredPosition('/jf', 'abc', 'auth', json(stored('2026-10-27T10:00:00Z')))).toEqual(stored('2026-10-27T10:00:00Z'))
        expect(await readStoredPosition('', 'abc', 'auth', json(null, 404))).toBeNull()
        expect(await readStoredPosition('', 'abc', 'auth', json({ cfi: 5 }))).toBeNull()
        expect(await readStoredPosition('', 'abc', 'auth', failing)).toBeNull()
    })

    it('stores a position and returns it as the server stored it', async () => {
        const fetchImpl = json(stored('2026-10-27T10:00:00Z'))
        expect(await writeStoredPosition('/jf', 'abc', 'auth', CFI, 0.6, false, fetchImpl)).toEqual(stored('2026-10-27T10:00:00Z'))
        expect(fetchImpl).toHaveBeenCalledWith('/jf/Oriel/Positions/abc', {
            method: 'PUT',
            headers: { Authorization: 'auth', 'Content-Type': 'application/json' },
            body: JSON.stringify({ cfi: CFI, fraction: 0.6 }),
            keepalive: false,
        })
        expect(await writeStoredPosition('', 'abc', 'auth', CFI, 0.6, false, json(null, 400))).toBeNull()
    })
})

describe('fallbackStart', () => {
    const stored = (fraction: number): StoredPosition => ({ cfi: 'epubcfi(/6/20!/4/2/1:0)', fraction, savedAt: '2026-10-29T12:00:00Z' })
    const jellyfin = (ticks: number | null): JellyfinPosition => ({ ticks, lastPlayed: '2026-10-29T11:00:00Z' })

    it("opens at Jellyfin's place first", () => {
        expect(fallbackStart(stored(0.3), jellyfin(6_000_000))).toEqual({ fraction: 0.6, from: 'jellyfin' })
    })

    it("opens at the saved place's own fraction when Jellyfin has no place", () => {
        expect(fallbackStart(stored(0.3), jellyfin(null))).toEqual({ fraction: 0.3, from: 'saved' })
        expect(fallbackStart(stored(0.3), null)).toEqual({ fraction: 0.3, from: 'saved' })
    })

    it('counts a place at 0 as the start, and opens at the start with neither', () => {
        expect(fallbackStart(stored(0.3), jellyfin(0))).toEqual({ fraction: 0.3, from: 'saved' })
        expect(fallbackStart(stored(0), jellyfin(0))).toEqual({ fraction: null, from: 'start' })
        expect(fallbackStart(null, null)).toEqual({ fraction: null, from: 'start' })
    })
})

describe('missingPlaceNotice', () => {
    it('says where the book opened instead', () => {
        expect(missingPlaceNotice({ fraction: 0.42, from: 'jellyfin' }))
            .toBe('Your saved place is not in this copy of the book, so it opened at 42%, where you were in Jellyfin.')
        expect(missingPlaceNotice({ fraction: 0.3, from: 'saved' }))
            .toBe('Your saved place is not in this copy of the book, so it opened at 30%, where you were.')
        expect(missingPlaceNotice({ fraction: null, from: 'start' }))
            .toBe('Your saved place is not in this copy of the book, so it opened at the start.')
    })
})
