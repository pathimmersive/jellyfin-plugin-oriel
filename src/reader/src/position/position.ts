import type { JellyfinPosition, StoredPosition } from '../api/client'

// A book's position as Jellyfin stores it: a fraction of the book on the
// one-second timeline jellyfin-web's book player uses, in ticks.
export const TICKS_PER_BOOK = 10_000_000
export const WRITE_DELAY_MS = 5000

/** The fraction to open at for saved ticks, or null to open at the start. */
export const fractionFromTicks = (ticks: number | null): number | null => {
    if (ticks === null || !Number.isFinite(ticks) || ticks <= 0) return null
    return Math.min(ticks / TICKS_PER_BOOK, 1)
}

export const ticksFromFraction = (fraction: number): number =>
    Math.round(Math.min(Math.max(fraction, 0), 1) * TICKS_PER_BOOK)

/** Where to open a book: an exact CFI, a fraction of the book, or null for the start of the text. */
export type StartAt = { cfi: string } | { fraction: number } | null

const time = (value: string | null | undefined): number => {
    const parsed = value ? Date.parse(value) : Number.NaN
    return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed
}

/**
 * Chooses where to open: Jellyfin's position when it was saved after Oriel's
 * stored one (the book was read elsewhere since), else Oriel's exact position,
 * else Jellyfin's, else the start.
 */
export const chooseStart = (stored: StoredPosition | null, jellyfin: JellyfinPosition | null): StartAt => {
    const fraction = fractionFromTicks(jellyfin?.ticks ?? null)
    if (stored && jellyfin && time(jellyfin.lastPlayed) > time(stored.savedAt)) {
        return fraction === null ? null : { fraction }
    }
    if (stored) return { cfi: stored.cfi }
    return fraction === null ? null : { fraction }
}

/** A position the reader has moved to. */
export interface Moved {
    cfi: string
    fraction: number
}

export interface PositionWriter {
    /** A new position after the reader moved; saved after a quiet period. */
    moved(position: Moved): void
    /** Saves a pending position now, for when the page is being hidden. */
    flush(): void
}

/**
 * Saves the position as the reader moves: `delayMs` after the last move, or at
 * once on `flush()`. A position equal to the last one saved, or to the one the
 * book was opened at, is not saved again.
 */
export const positionWriter = (
    save: (position: Moved, keepalive: boolean) => Promise<boolean>,
    openedAt: string | null,
    delayMs = WRITE_DELAY_MS,
    timers: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'> = globalThis,
): PositionWriter => {
    let saved = openedAt
    let pending: Moved | null = null
    let timer: ReturnType<typeof setTimeout> | null = null

    const send = (keepalive: boolean): void => {
        if (timer !== null) timers.clearTimeout(timer)
        timer = null
        const position = pending
        pending = null
        if (position === null || position.cfi === saved) return
        saved = position.cfi
        void save(position, keepalive).then(ok => {
            // Let the next move try again if the save did not go through.
            if (!ok && saved === position.cfi) saved = null
        })
    }

    return {
        moved(position) {
            pending = position
            if (timer !== null) timers.clearTimeout(timer)
            timer = timers.setTimeout(() => send(false), delayMs)
        },
        flush() {
            send(true)
        },
    }
}

/**
 * Saves a position to Oriel's store and then to Jellyfin, stamping Jellyfin's
 * copy with the store's time so that Oriel's own save never looks newer than
 * itself, whatever the device clock says. When the store cannot be written,
 * Jellyfin's copy is stamped with the current time, so it wins on the next open.
 */
export const saveBoth = async (
    position: Moved,
    keepalive: boolean,
    writeStored: (cfi: string, fraction: number, keepalive: boolean) => Promise<StoredPosition | null>,
    writeJellyfin: (ticks: number, lastPlayed: string, keepalive: boolean) => Promise<boolean>,
    now: () => Date = () => new Date(),
): Promise<boolean> => {
    const stored = await writeStored(position.cfi, position.fraction, keepalive)
    const mirrored = await writeJellyfin(ticksFromFraction(position.fraction), stored?.savedAt ?? now().toISOString(), keepalive)
    return stored !== null && mirrored
}
