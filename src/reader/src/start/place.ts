import { type PageCount, progressShown, type ProgressShown } from '../controls/progress'
import type { Place } from '../engine/engine'
import type { Progress } from '../settings/settings'

/** What showing the place needs. */
export interface PlaceSources {
    /** The place shown now. */
    place(): Place
    /** What Progress shows. */
    progress(): Progress
    /** The page count, or null while there is none. */
    count(): PageCount | null
    /** Whether the book is laid out beside a panel. */
    beside(): boolean
    /** Shows the place in the footers, as `Controls.locate` does. */
    locate(chapter: string, fraction: number, progress: ProgressShown, left: number | null): void
}

/**
 * Shows the place in the footers. Beside a panel the chapter and percent
 * follow the place, and the page number stays the last one shown while the
 * place has not moved.
 */
export const createPlaceShown = (sources: PlaceSources): () => void => {
    let lastShown: { fraction: number, progress: ProgressShown, left: number | null } | null = null
    return () => {
        const { chapter, fraction, pages } = sources.place()
        if (sources.beside()) {
            const same = lastShown !== null && Math.abs(lastShown.fraction - fraction) < 0.005
            sources.locate(chapter, fraction, same ? lastShown!.progress : progressShown('percent', fraction, null, null), same ? lastShown!.left : null)
            return
        }
        const progress = progressShown(sources.progress(), fraction, sources.count(), pages)
        lastShown = { fraction, progress, left: pages?.left ?? null }
        sources.locate(chapter, fraction, progress, lastShown.left)
    }
}
