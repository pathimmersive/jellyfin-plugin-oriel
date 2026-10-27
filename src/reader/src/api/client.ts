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

/** The position Jellyfin has saved for a book, in ticks, or null when none can be read. */
export const readPositionTicks = async (
    basePath: string,
    itemId: string,
    userId: string,
    authorization: string,
    fetchImpl: typeof fetch = fetch,
): Promise<number | null> => {
    try {
        const response = await fetchImpl(userDataUrl(basePath, itemId, userId), { headers: { Authorization: authorization } })
        if (!response.ok) return null
        const data = await response.json() as { PlaybackPositionTicks?: unknown }
        return typeof data.PlaybackPositionTicks === 'number' ? data.PlaybackPositionTicks : null
    } catch {
        return null
    }
}

/**
 * Saves a book's position in Jellyfin's user data. Returns whether the server
 * accepted it; `keepalive` lets the request finish while the page is closing.
 */
export const writePositionTicks = async (
    basePath: string,
    itemId: string,
    userId: string,
    authorization: string,
    ticks: number,
    keepalive = false,
    fetchImpl: typeof fetch = fetch,
): Promise<boolean> => {
    try {
        const response = await fetchImpl(userDataUrl(basePath, itemId, userId), {
            method: 'POST',
            headers: { Authorization: authorization, 'Content-Type': 'application/json' },
            body: JSON.stringify({ PlaybackPositionTicks: ticks }),
            keepalive,
        })
        return response.ok
    } catch {
        return false
    }
}
