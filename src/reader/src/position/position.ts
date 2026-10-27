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

export interface PositionWriter {
    /** A new position after the reader moved; written after a quiet period. */
    moved(fraction: number): void
    /** Writes a pending position now, for when the page is being hidden. */
    flush(): void
}

/**
 * Writes the position back as the reader moves: `delayMs` after the last move,
 * or at once on `flush()`. A position equal to the last one written, or to the
 * one the book was opened at, is not written.
 */
export const positionWriter = (
    write: (ticks: number, keepalive: boolean) => Promise<boolean>,
    openedAtTicks: number | null,
    delayMs = WRITE_DELAY_MS,
    timers: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'> = globalThis,
): PositionWriter => {
    let written = openedAtTicks ?? 0
    let pending: number | null = null
    let timer: ReturnType<typeof setTimeout> | null = null

    const send = (keepalive: boolean): void => {
        if (timer !== null) timers.clearTimeout(timer)
        timer = null
        const ticks = pending
        pending = null
        if (ticks === null || ticks === written) return
        written = ticks
        void write(ticks, keepalive).then(ok => {
            // Let the next move try again if the server did not take this one.
            if (!ok && written === ticks) written = -1
        })
    }

    return {
        moved(fraction) {
            pending = ticksFromFraction(fraction)
            if (timer !== null) timers.clearTimeout(timer)
            timer = timers.setTimeout(() => send(false), delayMs)
        },
        flush() {
            send(true)
        },
    }
}
