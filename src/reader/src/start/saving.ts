import { writeJellyfinPosition, writeStoredPosition } from '../api/client'
import { ICONS, NOTICE_TEXT, saveNotice } from '../controls/failure'
import type { OpenBook } from '../engine/engine'
import { positionWriter, saveBoth } from '../position/position'
import { showNotice } from './notices'
import type { ReaderServer } from './server'
import { signIn } from './sign-in'

// A save refused because the session has ended, or failed another way, says
// so at the bottom of the page: signed out until the page is left, not saved
// until a save goes through.
const saveNotices = (itemId: string): (kind: 'signedOut' | 'notSaved' | null) => void => {
    let shown: { kind: 'signedOut' | 'notSaved', element: HTMLElement } | null = null
    return kind => {
        if (shown?.kind === 'signedOut' || shown?.kind === kind) return
        shown?.element.remove()
        shown = kind && {
            kind,
            element: kind === 'signedOut'
                ? showNotice(NOTICE_TEXT.signedOut, ICONS.person, { label: 'Sign in', run: () => void signIn(itemId) })
                : showNotice(NOTICE_TEXT.notSaved, ICONS.cloudOff),
        }
    }
}

/**
 * Saves the exact position to Oriel's store and the approximate one to
 * Jellyfin as the reader moves, so Resume, Continue Reading and the built-in
 * reader pick up where reading stopped here. While the store is unavailable
 * nothing is saved, and a notice says so. The first move takes `missing`, the
 * notice of a saved place that is not in the book, away.
 */
export const savePlaces = (opened: OpenBook, { basePath, itemId, userId, authorization }: ReaderServer, storeUnavailable: boolean, missing: HTMLElement | null): void => {
    const placeSaveNotice = saveNotices(itemId)
    let notice = missing
    if (storeUnavailable) showNotice(NOTICE_TEXT.unavailable, ICONS.cloudOff)
    const writer = storeUnavailable ? null : positionWriter(
        async (position, keepalive) => {
            let refused = false
            const watched: typeof fetch = async (input, init) => {
                const response = await fetch(input, init)
                if (response.status === 401) refused = true
                return response
            }
            const saved = await saveBoth(position, keepalive,
                (cfi, fraction, keep) => writeStoredPosition(basePath, itemId, authorization, cfi, fraction, keep, watched),
                (ticks, lastPlayed, keep) => writeJellyfinPosition(basePath, itemId, userId, authorization, ticks, lastPlayed, keep, watched))
            placeSaveNotice(saveNotice(saved, refused ? 401 : null))
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
