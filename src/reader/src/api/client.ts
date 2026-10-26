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
