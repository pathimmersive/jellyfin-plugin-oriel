import { writeJellyfinPosition, writeStoredPosition } from '../api/client'
import { NOTICE_TEXT } from '../controls/failure'
import { ICONS } from '../controls/icons'
import type { OpenBook } from '../engine/engine'
import { positionWriter, savePlace } from '../position/position'
import { showNotice } from './notices'
import type { SaveNotices } from './save-notices'
import type { ReaderServer } from './server'

/**
 * Saves the position as the reader moves, in Oriel's store and, by the server,
 * in Jellyfin, so Resume, Continue Reading and the built-in reader pick up
 * where reading stopped here. While the store is unavailable
 * nothing is saved, and a notice says so. The first move takes `missing`, the
 * notice of a saved place that is not in the book, away.
 */
export const savePlaces = (opened: OpenBook, { basePath, itemId, userId, authorization, fetch }: ReaderServer, storeUnavailable: boolean, missing: HTMLElement | null, notices: SaveNotices): void => {
    let notice = missing
    if (storeUnavailable) showNotice(NOTICE_TEXT.unavailable, ICONS.cloudOff)
    const writer = storeUnavailable ? null : positionWriter(
        async (position, keepalive) => {
            const saved = await savePlace(position, keepalive,
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
