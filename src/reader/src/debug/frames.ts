/** Frames slower than this count as long: about three missed frames at 60 Hz. */
export const LONG_FRAME_MS = 50

export interface FrameStats {
    /** Frames longer than LONG_FRAME_MS. */
    longFrames: number
    /** The longest frame, in milliseconds; 0 with fewer than two timestamps. */
    worstFrame: number
}

/** Statistics for consecutive requestAnimationFrame timestamps. */
export const frameStats = (timestamps: readonly number[], longFrameMs = LONG_FRAME_MS): FrameStats => {
    let longFrames = 0
    let worstFrame = 0
    for (let i = 1; i < timestamps.length; i++) {
        const frame = timestamps[i] - timestamps[i - 1]
        if (frame > longFrameMs) longFrames++
        if (frame > worstFrame) worstFrame = frame
    }
    return { longFrames, worstFrame: Math.round(worstFrame) }
}

/** Whether the page asked for the debug overlay (?debug or ?debug=1, not ?debug=0). */
export const debugRequested = (search: string): boolean => {
    const value = new URLSearchParams(search).get('debug')
    return value !== null && value !== '0' && value !== 'false'
}
