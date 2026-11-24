import type { OpenBook } from '../engine/engine'
import { fallbackStart, missingPlaceNotice } from '../position/position'
import { showNotice } from './notices'
import type { FetchedBook } from './fetch'

/**
 * A saved place that is not in this copy of the book (another edition, or an
 * import from another server): opens somewhere sensible and says so. The
 * notice, or null when the book opened where it was asked to.
 */
export const placeMissing = async (opened: OpenBook, { stored, jellyfin }: FetchedBook): Promise<HTMLElement | null> => {
    if (opened.placed) return null
    const fallback = fallbackStart(stored, jellyfin)
    await opened.reopen(fallback.fraction)
    return showNotice(missingPlaceNotice(fallback))
}
