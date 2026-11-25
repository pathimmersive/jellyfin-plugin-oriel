import { writeJellyfinPosition, writeStoredPosition } from '../api/client'
import { ICONS, NOTICE_TEXT } from '../controls/failure'
import type { OpenBook } from '../engine/engine'
import { positionWriter, saveBoth } from '../position/position'
import { showNotice } from './notices'
import type { SaveNotices } from './save-notices'
import type { ReaderServer } from './server'

/**
 * Saves the exact position to Oriel's store and the approximate one to
 * Jellyfin as the reader moves, so Resume, Continue Reading and the built-in
 * reader pick up where reading stopped here. While the store is unavailable
 * nothing is saved, and a notice says so. The first move takes `missing`, the
 * notice of a saved place that is not in the book, away.
 */
export const savePlaces = (opened: OpenBook, { basePath, itemId, userId, authorization, fetch }: ReaderServer, storeUnavailable: boolean, missing: HTMLElement | null, notices: SaveNotices): void => {
    let notice = missing
    if (storeUnavailable) showNotice(NOTICE_TEXT.unavailable, ICONS.cloudOff)
    const writer = storeUnavailable ? null : positionWriter(
        async (position, keepalive) => {
            const saved = await saveBoth(position, keepalive,
                (cfi, fraction, keep) => writeStoredPosition(basePath, itemId, authorization, cfi, fraction, keep, fetch),
                (ticks, lastPlayed, keep) => writeJellyfinPosition(basePath, itemId, userId, authorization, ticks, lastPlayed, keep, fetch))
            notices.saved(saved)
            return saved
        },
        opened.openedAt)
    opened.onMoved(position => {
        if (notice && position.cfi !== opened.openedAt) {
            notice.remove()
            notice = null
        }
        writer?.moved(position)
    })
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') writer?.flush()
    })
    window.addEventListener('pagehide', () => writer?.flush())
}
