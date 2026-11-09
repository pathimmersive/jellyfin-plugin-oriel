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

/** Bytes received so far, and the file's size when the server says it. */
export type DownloadProgress = (done: number, total: number | null) => void

// The file's size from Content-Length, unless the body is encoded, when the
// header counts the encoded bytes rather than the ones received.
const declaredSize = (headers: Headers): number | null => {
    if (headers.get('Content-Encoding')) return null
    const size = Number(headers.get('Content-Length'))
    return Number.isInteger(size) && size > 0 ? size : null
}

/**
 * Fetches a book file through /Items/{id}/Download, which applies the user's
 * library access and download permission, reporting the bytes as they arrive.
 * The file takes the name the server gives it, lower-cased, because foliate-js
 * tells some formats (comics) from EPUB by name; without one it is named as
 * an EPUB.
 */
export const downloadBook = async (
    basePath: string,
    itemId: string,
    authorization: string,
    fetchImpl: typeof fetch = fetch,
    progress: DownloadProgress = () => {},
): Promise<File> => {
    const response = await fetchImpl(`${basePath}/Items/${encodeURIComponent(itemId)}/Download`, {
        headers: { Authorization: authorization },
    })
    if (!response.ok) throw new BookLoadError(downloadErrorMessage(response.status), response.status)
    const total = declaredSize(response.headers)
    const chunks: Uint8Array<ArrayBuffer>[] = []
    let done = 0
    progress(done, total)
    if (response.body) {
        const reader = response.body.getReader()
        for (;;) {
            const { done: finished, value } = await reader.read()
            if (finished) break
            chunks.push(value as Uint8Array<ArrayBuffer>)
            done += value.byteLength
            progress(done, total)
        }
    }
    const type = response.headers.get('Content-Type') ?? ''
    const name = attachmentName(response.headers.get('Content-Disposition'))?.toLowerCase() || `${itemId}.epub`
    return new File(chunks, name, { type })
}

/** What the loading screen shows of a book before it opens. */
export interface BookDetails {
    title: string
    /** The book's cover from Jellyfin, or null when it has none. */
    cover: string | null
}

/**
 * The book's title and cover from /Items/{id}, or null when they cannot be
 * read: the loading screen then goes without them.
 */
export const readBookDetails = async (
    basePath: string,
    itemId: string,
    userId: string,
    authorization: string,
    fetchImpl: typeof fetch = fetch,
): Promise<BookDetails | null> => {
    try {
        const id = encodeURIComponent(itemId)
        const response = await fetchImpl(`${basePath}/Items/${id}?userId=${encodeURIComponent(userId)}`, {
            headers: { Authorization: authorization },
        })
        if (!response.ok) return null
        const item = await response.json() as { Name?: unknown, ImageTags?: { Primary?: unknown } }
        const tag = item.ImageTags?.Primary
        return {
            title: typeof item.Name === 'string' ? item.Name : '',
            cover: typeof tag === 'string' && tag
                ? `${basePath}/Items/${id}/Images/Primary?tag=${encodeURIComponent(tag)}&maxWidth=360`
                : null,
        }
    } catch {
        return null
    }
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

const bookmarksUrl = (basePath: string, itemId: string, id = ''): string =>
    `${basePath}/Oriel/Bookmarks/${encodeURIComponent(itemId)}${id ? `/${encodeURIComponent(id)}` : ''}`

const highlightsUrl = (basePath: string, itemId: string, id = ''): string =>
    `${basePath}/Oriel/Highlights/${encodeURIComponent(itemId)}${id ? `/${encodeURIComponent(id)}` : ''}`

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

/** A bookmark as Oriel's store keeps it: where its page starts, the text the page opens with, and when it was made. */
export interface Bookmark {
    id: string
    cfi: string
    fraction: number
    text: string
    createdAt: string
}

export const isBookmark = (value: unknown): value is Bookmark => {
    const bookmark = value as Partial<Bookmark> | null
    return typeof bookmark?.id === 'string' && typeof bookmark.cfi === 'string' && typeof bookmark.fraction === 'number'
        && typeof bookmark.text === 'string' && typeof bookmark.createdAt === 'string'
}

/** The user's bookmarks in a book, or null when they cannot be read. */
export const readBookmarks = async (
    basePath: string,
    itemId: string,
    authorization: string,
    fetchImpl: typeof fetch = fetch,
): Promise<Bookmark[] | null> => {
    try {
        const response = await fetchImpl(bookmarksUrl(basePath, itemId), { headers: { Authorization: authorization } })
        if (!response.ok) return null
        const data: unknown = await response.json()
        return Array.isArray(data) && data.every(isBookmark) ? data : null
    } catch {
        return null
    }
}

/** Bookmarks a page; returns the bookmark as stored (or the one already there), or null when that failed. */
export const addBookmark = async (
    basePath: string,
    itemId: string,
    authorization: string,
    cfi: string,
    fraction: number,
    text: string,
    fetchImpl: typeof fetch = fetch,
): Promise<Bookmark | null> => {
    try {
        const response = await fetchImpl(bookmarksUrl(basePath, itemId), {
            method: 'POST',
            headers: { Authorization: authorization, 'Content-Type': 'application/json' },
            body: JSON.stringify({ cfi, fraction, text }),
        })
        if (!response.ok) return null
        const data: unknown = await response.json()
        return isBookmark(data) ? data : null
    } catch {
        return null
    }
}

/** Removes a bookmark; returns whether it is gone (true too when the server had it no longer). */
export const removeBookmark = async (
    basePath: string,
    itemId: string,
    authorization: string,
    id: string,
    fetchImpl: typeof fetch = fetch,
): Promise<boolean> => {
    try {
        const response = await fetchImpl(bookmarksUrl(basePath, itemId, id), { method: 'DELETE', headers: { Authorization: authorization } })
        return response.ok || response.status === 404
    } catch {
        return false
    }
}

/** A highlight as Oriel's store keeps it: the text it covers, its highlighter's colour, its note (empty for none), and when it was made. */
export interface Highlight {
    id: string
    cfi: string
    fraction: number
    colour: string
    text: string
    note: string
    createdAt: string
}

export const isHighlight = (value: unknown): value is Highlight => {
    const highlight = value as Partial<Highlight> | null
    return typeof highlight?.id === 'string' && typeof highlight.cfi === 'string' && typeof highlight.fraction === 'number'
        && typeof highlight.colour === 'string' && typeof highlight.text === 'string' && typeof highlight.note === 'string'
        && typeof highlight.createdAt === 'string'
}

/** The user's highlights in a book, or null when they cannot be read. */
export const readHighlights = async (
    basePath: string,
    itemId: string,
    authorization: string,
    fetchImpl: typeof fetch = fetch,
): Promise<Highlight[] | null> => {
    try {
        const response = await fetchImpl(highlightsUrl(basePath, itemId), { headers: { Authorization: authorization } })
        if (!response.ok) return null
        const data: unknown = await response.json()
        return Array.isArray(data) && data.every(isHighlight) ? data : null
    } catch {
        return null
    }
}

// Sends a highlight change; the highlight as stored, or null when that failed.
const sendHighlight = async (url: string, method: string, authorization: string, body: object, fetchImpl: typeof fetch): Promise<Highlight | null> => {
    try {
        const response = await fetchImpl(url, {
            method,
            headers: { Authorization: authorization, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        })
        if (!response.ok) return null
        const data: unknown = await response.json()
        return isHighlight(data) ? data : null
    } catch {
        return null
    }
}

/** Highlights text, with a note; returns the highlight as stored (or the one already there, in this colour and with this note), or null when that failed. */
export const addHighlight = (
    basePath: string,
    itemId: string,
    authorization: string,
    cfi: string,
    fraction: number,
    colour: string,
    text: string,
    note: string,
    fetchImpl: typeof fetch = fetch,
): Promise<Highlight | null> =>
    sendHighlight(highlightsUrl(basePath, itemId), 'POST', authorization, { cfi, fraction, colour, text, note }, fetchImpl)

/** Changes a highlight's colour, its note (empty for none), or both; returns the highlight as stored, or null when that failed. */
export const updateHighlight = (
    basePath: string,
    itemId: string,
    authorization: string,
    id: string,
    changes: { colour?: string, note?: string },
    fetchImpl: typeof fetch = fetch,
): Promise<Highlight | null> =>
    sendHighlight(highlightsUrl(basePath, itemId, id), 'PATCH', authorization, changes, fetchImpl)

/** Removes a highlight; returns whether it is gone (true too when the server had it no longer). */
export const removeHighlight = async (
    basePath: string,
    itemId: string,
    authorization: string,
    id: string,
    fetchImpl: typeof fetch = fetch,
): Promise<boolean> => {
    try {
        const response = await fetchImpl(highlightsUrl(basePath, itemId, id), { method: 'DELETE', headers: { Authorization: authorization } })
        return response.ok || response.status === 404
    } catch {
        return false
    }
}

/** A highlighter as Oriel's store keeps it: its id, name and colour (#rrggbb), whether it is built in, and how many of the user's highlights use it. */
export interface HighlighterRecord {
    id: string
    name: string
    colour: string
    builtIn: boolean
    uses: number
}

export const isHighlighterRecord = (value: unknown): value is HighlighterRecord => {
    const highlighter = value as Partial<HighlighterRecord> | null
    return typeof highlighter?.id === 'string' && typeof highlighter.name === 'string' && typeof highlighter.colour === 'string'
        && typeof highlighter.builtIn === 'boolean' && typeof highlighter.uses === 'number'
}

const highlightersUrl = (basePath: string): string => `${basePath}/Oriel/Highlighters`

/** The user's highlighters in their order, or null when they cannot be read. */
export const readHighlighters = async (
    basePath: string,
    authorization: string,
    fetchImpl: typeof fetch = fetch,
): Promise<HighlighterRecord[] | null> => {
    try {
        const response = await fetchImpl(highlightersUrl(basePath), { headers: { Authorization: authorization } })
        if (!response.ok) return null
        const data: unknown = await response.json()
        return Array.isArray(data) && data.every(isHighlighterRecord) ? data : null
    } catch {
        return null
    }
}

/** Keeps the user's whole list of highlighters (a new one without an id); returns them as kept, or null when that failed. */
export const saveHighlighters = async (
    basePath: string,
    authorization: string,
    list: { id?: string, name: string, colour: string }[],
    fetchImpl: typeof fetch = fetch,
): Promise<HighlighterRecord[] | null> => {
    try {
        const response = await fetchImpl(highlightersUrl(basePath), {
            method: 'PUT',
            headers: { Authorization: authorization, 'Content-Type': 'application/json' },
            body: JSON.stringify(list),
        })
        if (!response.ok) return null
        const data: unknown = await response.json()
        return Array.isArray(data) && data.every(isHighlighterRecord) ? data : null
    } catch {
        return null
    }
}

/** One of the user's own font files, as Oriel's store keeps it: one style of a family. */
export interface OwnFont {
    id: string
    family: string
    style: string
    weight: number
    italic: boolean
    format: 'ttf' | 'otf' | 'woff2'
}

export const isOwnFont = (value: unknown): value is OwnFont => {
    const font = value as Partial<OwnFont> | null
    return typeof font?.id === 'string' && typeof font.family === 'string' && typeof font.style === 'string'
        && typeof font.weight === 'number' && typeof font.italic === 'boolean' && ['ttf', 'otf', 'woff2'].includes(font.format ?? '')
}

const fontsUrl = (basePath: string): string => `${basePath}/Oriel/Fonts`

/** The user's font files, or null when they cannot be read. */
export const readFonts = async (
    basePath: string,
    authorization: string,
    fetchImpl: typeof fetch = fetch,
): Promise<OwnFont[] | null> => {
    try {
        const response = await fetchImpl(fontsUrl(basePath), { headers: { Authorization: authorization } })
        if (!response.ok) return null
        const data: unknown = await response.json()
        return Array.isArray(data) && data.every(isOwnFont) ? data : null
    } catch {
        return null
    }
}

/** Why a font file was not added: too large, not a font, one too many, or anything else. */
export type FontRefusal = 'tooLarge' | 'notAFont' | 'tooMany' | 'failed'

/** Adds a font file; returns it as kept, or why it was refused. */
export const addFont = async (
    basePath: string,
    authorization: string,
    file: Blob,
    fetchImpl: typeof fetch = fetch,
): Promise<OwnFont | FontRefusal> => {
    try {
        const response = await fetchImpl(fontsUrl(basePath), {
            method: 'POST',
            headers: { Authorization: authorization, 'Content-Type': 'application/octet-stream' },
            body: file,
        })
        if (response.status === 413) return 'tooLarge'
        const data: unknown = await response.json().catch(() => null)
        if (response.status === 400) {
            const reason = (data as { reason?: unknown } | null)?.reason
            return reason === 'tooMany' || reason === 'notAFont' ? reason : 'failed'
        }
        return response.ok && isOwnFont(data) ? data : 'failed'
    } catch {
        return 'failed'
    }
}

/** One of the user's font files, or null when it cannot be read. */
export const readFontFile = async (
    basePath: string,
    authorization: string,
    id: string,
    fetchImpl: typeof fetch = fetch,
): Promise<Blob | null> => {
    try {
        const response = await fetchImpl(`${fontsUrl(basePath)}/${encodeURIComponent(id)}`, { headers: { Authorization: authorization } })
        return response.ok ? await response.blob() : null
    } catch {
        return null
    }
}

/** Removes every file of one of the user's font families; false when that failed. */
export const removeFontFamily = async (
    basePath: string,
    authorization: string,
    family: string,
    fetchImpl: typeof fetch = fetch,
): Promise<boolean> => {
    try {
        const response = await fetchImpl(`${fontsUrl(basePath)}?family=${encodeURIComponent(family)}`, { method: 'DELETE', headers: { Authorization: authorization } })
        return response.ok || response.status === 404
    } catch {
        return false
    }
}

/** What the admin has set for every reader: the translation address, with {text} where the text goes, empty when Translate is off. */
export interface ReaderSettings {
    translateUrl: string
}

/** The admin's settings for every reader, or null when they cannot be read. */
export const readReaderSettings = async (
    basePath: string,
    authorization: string,
    fetchImpl: typeof fetch = fetch,
): Promise<ReaderSettings | null> => {
    try {
        const response = await fetchImpl(`${basePath}/Oriel/ReaderSettings`, { headers: { Authorization: authorization } })
        if (!response.ok) return null
        const data = await response.json() as Partial<ReaderSettings> | null
        return typeof data?.translateUrl === 'string' ? { translateUrl: data.translateUrl } : null
    } catch {
        return null
    }
}

/** A word's senses as one part of speech: noun, verb, adjective or adverb. */
export interface DictionaryEntry {
    word: string
    partOfSpeech: string
    senses: string[]
}

/** A word's definitions from the server's dictionary: the word as found and its entries. */
export interface Definition {
    word: string
    entries: DictionaryEntry[]
}

/** A word looked up: its definition, none in the dictionary, or a failure to ask. */
export type WordLookup = { found: Definition } | { missing: true } | { failed: true }

const isDictionaryEntry = (value: unknown): value is DictionaryEntry => {
    const entry = value as Partial<DictionaryEntry> | null
    return typeof entry?.word === 'string' && typeof entry.partOfSpeech === 'string'
        && Array.isArray(entry.senses) && entry.senses.every(sense => typeof sense === 'string')
}

/** Looks a word up in the dictionary on the server. */
export const lookUpWord = async (
    basePath: string,
    authorization: string,
    word: string,
    fetchImpl: typeof fetch = fetch,
): Promise<WordLookup> => {
    try {
        const response = await fetchImpl(`${basePath}/Oriel/Dictionary?word=${encodeURIComponent(word)}`, { headers: { Authorization: authorization } })
        if (response.status === 404) return { missing: true }
        if (!response.ok) return { failed: true }
        const data = await response.json() as Partial<Definition> | null
        return typeof data?.word === 'string' && Array.isArray(data.entries) && data.entries.length > 0 && data.entries.every(isDictionaryEntry)
            ? { found: { word: data.word, entries: data.entries } }
            : { failed: true }
    } catch {
        return { failed: true }
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
