// The marker the reader leaves before sending a signed-out user to the
// jellyfin-web login page. The jellyfin-web launcher (src/integration/launcher.js)
// reads it after sign-in and opens the book in Oriel again; it uses the same key,
// age limit and id format.
export const RETURN_KEY = 'oriel_return'
export const RETURN_MAX_AGE_MS = 10 * 60 * 1000

const ITEM_ID = /^[0-9a-f]{32}$/i

export interface ReturnMarker {
    id: string
    at: number
}

/** Stores the book to return to; only a Jellyfin item id is ever stored. */
export const saveReturnMarker = (storage: Pick<Storage, 'setItem'>, itemId: string | null, now = Date.now()): boolean => {
    if (!itemId || !ITEM_ID.test(itemId)) return false
    const marker: ReturnMarker = { id: itemId, at: now }
    try {
        storage.setItem(RETURN_KEY, JSON.stringify(marker))
        return true
    } catch {
        return false
    }
}
