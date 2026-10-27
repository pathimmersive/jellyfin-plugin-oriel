/** A book could not be fetched; the message is meant for the reader. */
export class BookLoadError extends Error {
    constructor(message: string, readonly status?: number) {
        super(message)
        this.name = 'BookLoadError'
    }
}

export const downloadErrorMessage = (status: number): string => {
    switch (status) {
        case 401:
            return 'Your Jellyfin session has expired. Sign in to Jellyfin again.'
        case 403:
            return 'You do not have permission to download this book. Ask your Jellyfin administrator.'
        case 404:
            return 'This book was not found in your Jellyfin library.'
        default:
            return `The book could not be loaded (HTTP ${status}).`
    }
}

/**
 * Fetches a book file through /Items/{id}/Download, which applies the user's
 * library access and download permission.
 */
export const downloadBook = async (
    basePath: string,
    itemId: string,
    authorization: string,
    fetchImpl: typeof fetch = fetch,
): Promise<File> => {
    const response = await fetchImpl(`${basePath}/Items/${encodeURIComponent(itemId)}/Download`, {
        headers: { Authorization: authorization },
    })
    if (!response.ok) throw new BookLoadError(downloadErrorMessage(response.status), response.status)
    const blob = await response.blob()
    return new File([blob], `${itemId}.epub`, { type: blob.type })
}

/**
 * The server's id from the anonymous /System/Info/Public, or null when it cannot
 * be read in time. Only used to address the jellyfin-web login page.
 */
export const publicServerId = async (
    basePath: string,
    fetchImpl: typeof fetch = fetch,
    timeoutMs = 3000,
): Promise<string | null> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
        const response = await fetchImpl(`${basePath}/System/Info/Public`, { signal: controller.signal })
        if (!response.ok) return null
        const info = await response.json() as { Id?: unknown }
        return typeof info.Id === 'string' && info.Id ? info.Id : null
    } catch {
        return null
    } finally {
        clearTimeout(timer)
    }
}

const userDataUrl = (basePath: string, itemId: string, userId: string): string =>
    `${basePath}/UserItems/${encodeURIComponent(itemId)}/UserData?userId=${encodeURIComponent(userId)}`

const positionUrl = (basePath: string, itemId: string): string =>
    `${basePath}/Oriel/Positions/${encodeURIComponent(itemId)}`

/** The position Jellyfin keeps for a book: ticks on its one-second timeline, and when it was last saved. */
export interface JellyfinPosition {
    ticks: number | null
    lastPlayed: string | null
}

/** The exact position Oriel's store keeps for a book. */
export interface StoredPosition {
    cfi: string
    fraction: number
    savedAt: string
}

/** The position Jellyfin has saved for a book, or null when it cannot be read. */
export const readJellyfinPosition = async (
    basePath: string,
    itemId: string,
    userId: string,
    authorization: string,
    fetchImpl: typeof fetch = fetch,
): Promise<JellyfinPosition | null> => {
    try {
        const response = await fetchImpl(userDataUrl(basePath, itemId, userId), { headers: { Authorization: authorization } })
        if (!response.ok) return null
        const data = await response.json() as { PlaybackPositionTicks?: unknown, LastPlayedDate?: unknown }
        return {
            ticks: typeof data.PlaybackPositionTicks === 'number' ? data.PlaybackPositionTicks : null,
            lastPlayed: typeof data.LastPlayedDate === 'string' ? data.LastPlayedDate : null,
        }
    } catch {
        return null
    }
}

/**
 * Saves a book's position in Jellyfin's user data, with the time it was saved.
 * Returns whether the server accepted it; `keepalive` lets the request finish
 * while the page is closing.
 */
export const writeJellyfinPosition = async (
    basePath: string,
    itemId: string,
    userId: string,
    authorization: string,
    ticks: number,
    lastPlayed: string,
    keepalive = false,
    fetchImpl: typeof fetch = fetch,
): Promise<boolean> => {
    try {
        const response = await fetchImpl(userDataUrl(basePath, itemId, userId), {
            method: 'POST',
            headers: { Authorization: authorization, 'Content-Type': 'application/json' },
            body: JSON.stringify({ PlaybackPositionTicks: ticks, LastPlayedDate: lastPlayed }),
            keepalive,
        })
        return response.ok
    } catch {
        return false
    }
}

const isStoredPosition = (value: unknown): value is StoredPosition => {
    const position = value as Partial<StoredPosition> | null
    return typeof position?.cfi === 'string' && typeof position.fraction === 'number' && typeof position.savedAt === 'string'
}

/** The exact position Oriel stored for a book, or null when there is none or it cannot be read. */
export const readStoredPosition = async (
    basePath: string,
    itemId: string,
    authorization: string,
    fetchImpl: typeof fetch = fetch,
): Promise<StoredPosition | null> => {
    try {
        const response = await fetchImpl(positionUrl(basePath, itemId), { headers: { Authorization: authorization } })
        if (!response.ok) return null
        const data: unknown = await response.json()
        return isStoredPosition(data) ? data : null
    } catch {
        return null
    }
}

/** Stores the exact position for a book; returns it as stored (with the server's time), or null when that failed. */
export const writeStoredPosition = async (
    basePath: string,
    itemId: string,
    authorization: string,
    cfi: string,
    fraction: number,
    keepalive = false,
    fetchImpl: typeof fetch = fetch,
): Promise<StoredPosition | null> => {
    try {
        const response = await fetchImpl(positionUrl(basePath, itemId), {
            method: 'PUT',
            headers: { Authorization: authorization, 'Content-Type': 'application/json' },
            body: JSON.stringify({ cfi, fraction }),
            keepalive,
        })
        if (!response.ok) return null
        const data: unknown = await response.json()
        return isStoredPosition(data) ? data : null
    } catch {
        return null
    }
}
