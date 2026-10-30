import { type ImportResult, isImportResult } from '../data/summary'

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
 * library access and download permission. The file takes the name the server
 * gives it, lower-cased, because foliate-js tells some formats (comics) from
 * EPUB by name; without one it is named as an EPUB.
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
    const name = attachmentName(response.headers.get('Content-Disposition'))?.toLowerCase() || `${itemId}.epub`
    return new File([blob], name, { type: blob.type })
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

/** The reading data file from /Oriel/Export and the name the server gives it, or why it could not be had. */
export type ReadingDataFile = { ok: true, blob: Blob, fileName: string } | { ok: false, reason: string }

const DEFAULT_EXPORT_NAME = 'oriel-reading-data.json'

/** The file name in a Content-Disposition header, or null. */
export const attachmentName = (disposition: string | null): string | null => {
    if (!disposition) return null
    const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition)
    if (encoded) {
        try {
            return decodeURIComponent(encoded[1].trim())
        } catch { /* fall back to the plain name */ }
    }
    const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition)
    return plain ? plain[1].trim() : null
}

/** Downloads the signed-in user's reading data through /Oriel/Export. */
export const downloadReadingData = async (
    basePath: string,
    authorization: string,
    fetchImpl: typeof fetch = fetch,
): Promise<ReadingDataFile> => {
    try {
        const response = await fetchImpl(`${basePath}/Oriel/Export`, { headers: { Authorization: authorization } })
        if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` }
        const fileName = attachmentName(response.headers.get('Content-Disposition')) ?? DEFAULT_EXPORT_NAME
        return { ok: true, blob: await response.blob(), fileName }
    } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
}

/**
 * What importing a file did: the server's result, a file it rejected (not an
 * Oriel export, too new, malformed or too large; nothing was stored), or a
 * failure to reach it.
 */
export type ImportOutcome =
    | { kind: 'done', result: ImportResult }
    | { kind: 'rejected' }
    | { kind: 'failed', reason: string }

/** Imports a reading data file for the signed-in user through /Oriel/Import. */
export const importReadingData = async (
    basePath: string,
    authorization: string,
    file: Blob,
    fetchImpl: typeof fetch = fetch,
): Promise<ImportOutcome> => {
    try {
        const response = await fetchImpl(`${basePath}/Oriel/Import`, {
            method: 'POST',
            headers: { Authorization: authorization, 'Content-Type': 'application/json' },
            body: file,
        })
        if (response.status === 400) return { kind: 'rejected' }
        if (!response.ok) return { kind: 'failed', reason: `HTTP ${response.status}` }
        const result: unknown = await response.json()
        return isImportResult(result) ? { kind: 'done', result } : { kind: 'failed', reason: 'an unexpected reply' }
    } catch (error) {
        return { kind: 'failed', reason: error instanceof Error ? error.message : String(error) }
    }
}
