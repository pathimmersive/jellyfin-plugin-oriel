import { downloadBook, type JellyfinPosition, readBookDetails, readJellyfinPosition, readStoredPosition, type StoredPosition } from '../api/client'
import { clearFailure } from '../controls/failure'
import { loadingScreen } from '../loading/loading'
import { show, showFailed, status } from './page'
import { untilReached } from './retry'
import type { ReaderServer } from './server'

/** A book's file, and the places saved in it. */
export interface FetchedBook {
    file: File
    /** The place in Oriel's store, or null for none. */
    stored: StoredPosition | null
    /** True while Oriel's store cannot be opened on the server: the book opens at Jellyfin's place or the start, and nothing is saved. */
    storeUnavailable: boolean
    /** Jellyfin's place, or null for none. */
    jellyfin: JellyfinPosition | null
}

/**
 * Downloads the book behind the loading screen, whose title and cover come
 * beside the download, and the download's progress as its bytes arrive. While
 * the server cannot be reached the failure page says so, and the book and its
 * saved places are asked for again until it answers.
 */
export const fetchBook = async ({ basePath, itemId, userId, authorization, fetch }: ReaderServer): Promise<FetchedBook> => {
    const screen = loadingScreen(document.getElementById('loading')!)
    void readBookDetails(basePath, itemId, userId, authorization, fetch).then(screen.details)
    const [file, stored, jellyfin] = await untilReached(() => Promise.all([
        downloadBook(basePath, itemId, authorization, fetch, screen.progress),
        readStoredPosition(basePath, itemId, authorization, fetch),
        readJellyfinPosition(basePath, itemId, userId, authorization, fetch),
    ]), showFailed)
    clearFailure(status)
    show('loading', 'Opening the book…')
    screen.opening()
    return { file, stored: stored === 'unavailable' ? null : stored, storeUnavailable: stored === 'unavailable', jellyfin }
}
