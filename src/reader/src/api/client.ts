import { type ImportResult, isImportResult } from '../data/summary'
import { type Choices, type KeptChoices, type OwnTheme, THEME_ROLES } from '../settings/settings'

/** A book could not be fetched; the message is meant for the reader. */
export class BookLoadError extends Error {
    constructor(message: string, readonly status?: number) {
        super(message)
        this.name = 'BookLoadError'
    }
}

/** A book that stopped arriving: no byte of it came for as long as the reader waits. */
export class DownloadStalledError extends Error {
    constructor() {
        super('The book stopped arriving')
        this.name = 'DownloadStalledError'
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

/** What a request sends besides the session's authorization. */
interface Sent {
    method?: string
    /** A body sent as JSON. */
    json?: unknown
    /** A file sent as it is, with its type. */
    file?: { body: Blob, type: string }
    /** Lets the request finish while the page is closing. */
    keepalive?: boolean
    signal?: AbortSignal
}

/**
 * The server's answer to a request to `url` with `authorization` (none when
 * null), or, when no answer came, why: the error's message. Every request to
 * the server but the book's download goes through here.
 */
export const ask = async (fetchImpl: typeof fetch, url: string, authorization: string | null, sent: Sent = {}): Promise<Response | string> => {
    const headers: Record<string, string> = authorization === null ? {} : { Authorization: authorization }
    const init: RequestInit = {}
    if (sent.method) init.method = sent.method
    if (sent.json !== undefined) {
        headers['Content-Type'] = 'application/json'
        init.body = JSON.stringify(sent.json)
    } else if (sent.file) {
        headers['Content-Type'] = sent.file.type
        init.body = sent.file.body
    }
    if (Object.keys(headers).length) init.headers = headers
    if (sent.keepalive !== undefined) init.keepalive = sent.keepalive
    if (sent.signal) init.signal = sent.signal
    try {
        return await fetchImpl(url, init)
    } catch (error) {
        return error instanceof Error ? error.message : String(error)
    }
}

/** What an answer's body is when it is not JSON, or stopped arriving. */
export const NOT_JSON = Symbol('not JSON')

/** An answer's body as JSON, or NOT_JSON. */
export const bodyOf = (response: Response): Promise<unknown> => response.json().catch(() => NOT_JSON)

/** The JSON of a successful answer when `guard` accepts it; null for no answer, a refusal or anything else. */
export const accepted = async <T>(response: Response | string, guard: (value: unknown) => value is T): Promise<T | null> => {
    if (typeof response === 'string' || !response.ok) return null
    const data = await bodyOf(response)
    return guard(data) ? data : null
}

/** A guard for a list whose every item `guard` accepts. */
export const listOf = <T>(guard: (value: unknown) => value is T) => (value: unknown): value is T[] =>
    Array.isArray(value) && value.every(guard)

/** The reason a refusal's body gives, if any. */
const reasonOf = async (response: Response): Promise<unknown> => {
    const data = await bodyOf(response.clone())
    return typeof data === 'object' && data !== null ? (data as { reason?: unknown }).reason : undefined
}

/** Whether a delete left the thing gone: true too when the server had it no longer. */
const gone = (response: Response | string): boolean => typeof response !== 'string' && (response.ok || response.status === 404)

/** Bytes received so far, and the file's size when the server says it. */
export type DownloadProgress = (done: number, total: number | null) => void

/** How long a download may go without a byte before it has stalled. */
export const STALL_MS = 30_000
// The wait is counted in steps, so a device asleep, whose timers stop, has not waited through its sleep.
const STALL_STEPS = 10

// Calls `stalled` once nothing has been `heard` for STALL_MS, until `stop`.
const watchForStall = (stalled: () => void): { heard: () => void, stop: () => void } => {
    let quiet = 0
    const timer = setInterval(() => {
        if (++quiet < STALL_STEPS) return
        clearInterval(timer)
        stalled()
    }, STALL_MS / STALL_STEPS)
    return { heard: () => { quiet = 0 }, stop: () => clearInterval(timer) }
}

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
 * an EPUB. A download that goes STALL_MS without a byte, its answer's first
 * included, is dropped and fails as stalled.
 */
export const downloadBook = async (
    basePath: string,
    itemId: string,
    authorization: string,
    fetchImpl: typeof fetch = fetch,
    progress: DownloadProgress = () => {},
): Promise<File> => {
    const request = new AbortController()
    const stall = watchForStall(() => request.abort(new DownloadStalledError()))
    try {
        const response = await fetchImpl(`${basePath}/Items/${encodeURIComponent(itemId)}/Download`, {
            headers: { Authorization: authorization },
            signal: request.signal,
        })
        stall.heard()
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
                stall.heard()
                chunks.push(value)
                done += value.byteLength
                progress(done, total)
            }
        }
        const type = response.headers.get('Content-Type') ?? ''
        const name = attachmentName(response.headers.get('Content-Disposition'))?.toLowerCase() || `${itemId}.epub`
        return new File(chunks, name, { type })
    } catch (error) {
        // Browsers differ in what a request dropped part way throws.
        throw request.signal.aborted ? new DownloadStalledError() : error
    } finally {
        stall.stop()
    }
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
    const id = encodeURIComponent(itemId)
    const response = await ask(fetchImpl, `${basePath}/Items/${id}?userId=${encodeURIComponent(userId)}`, authorization)
    if (typeof response === 'string' || !response.ok) return null
    const item = await bodyOf(response) as { Name?: unknown, ImageTags?: { Primary?: unknown } } | null | typeof NOT_JSON
    if (item === NOT_JSON || item === null) return null
    const tag = item.ImageTags?.Primary
    return {
        title: typeof item.Name === 'string' ? item.Name : '',
        cover: typeof tag === 'string' && tag
            ? `${basePath}/Items/${id}/Images/Primary?tag=${encodeURIComponent(tag)}&maxWidth=360`
            : null,
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
        const info = await accepted(await ask(fetchImpl, `${basePath}/System/Info/Public`, null, { signal: controller.signal }),
            (value): value is { Id: string } => typeof (value as { Id?: unknown } | null)?.Id === 'string')
        return info?.Id || null
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
    const response = await ask(fetchImpl, userDataUrl(basePath, itemId, userId), authorization)
    if (typeof response === 'string' || !response.ok) return null
    const data = await bodyOf(response) as { PlaybackPositionTicks?: unknown, LastPlayedDate?: unknown } | null | typeof NOT_JSON
    if (data === NOT_JSON || data === null) return null
    return {
        ticks: typeof data.PlaybackPositionTicks === 'number' ? data.PlaybackPositionTicks : null,
        lastPlayed: typeof data.LastPlayedDate === 'string' ? data.LastPlayedDate : null,
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
    const response = await ask(fetchImpl, userDataUrl(basePath, itemId, userId), authorization,
        { method: 'POST', json: { PlaybackPositionTicks: ticks, LastPlayedDate: lastPlayed }, keepalive })
    return typeof response !== 'string' && response.ok
}

const isStoredPosition = (value: unknown): value is StoredPosition => {
    const position = value as Partial<StoredPosition> | null
    return typeof position?.cfi === 'string' && typeof position.fraction === 'number' && typeof position.savedAt === 'string'
}

/**
 * The exact position Oriel stored for a book, or null when there is none or it cannot be read;
 * 'unavailable' when the server says Oriel's reading data store cannot be opened.
 */
export const readStoredPosition = async (
    basePath: string,
    itemId: string,
    authorization: string,
    fetchImpl: typeof fetch = fetch,
): Promise<StoredPosition | null | 'unavailable'> => {
    const response = await ask(fetchImpl, positionUrl(basePath, itemId), authorization)
    if (typeof response !== 'string' && response.status === 503) return await reasonOf(response) === 'storeUnavailable' ? 'unavailable' : null
    return accepted(response, isStoredPosition)
}

/**
 * Stores the exact position for a book; returns it as stored (with the server's time), null when the server
 * answered that it did not, or 'unanswered' when no answer came, as when the page is closing: it may be stored.
 */
export const writeStoredPosition = async (
    basePath: string,
    itemId: string,
    authorization: string,
    cfi: string,
    fraction: number,
    keepalive = false,
    fetchImpl: typeof fetch = fetch,
): Promise<StoredPosition | null | 'unanswered'> => {
    const response = await ask(fetchImpl, positionUrl(basePath, itemId), authorization, { method: 'PUT', json: { cfi, fraction }, keepalive })
    if (typeof response === 'string') return 'unanswered'
    if (!response.ok) return null
    const data = await bodyOf(response)
    // A body that stopped arriving is no answer either.
    if (data === NOT_JSON) return 'unanswered'
    return isStoredPosition(data) ? data : null
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
    return accepted(await ask(fetchImpl, bookmarksUrl(basePath, itemId), authorization), listOf(isBookmark))
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
): Promise<Bookmark | null | 'limitReached'> => {
    const response = await ask(fetchImpl, bookmarksUrl(basePath, itemId), authorization, { method: 'POST', json: { cfi, fraction, text } })
    if (await limitReached(response)) return 'limitReached'
    return accepted(response, isBookmark)
}

/** Removes a bookmark; returns whether it is gone (true too when the server had it no longer). */
export const removeBookmark = async (
    basePath: string,
    itemId: string,
    authorization: string,
    id: string,
    fetchImpl: typeof fetch = fetch,
): Promise<boolean> => {
    return gone(await ask(fetchImpl, bookmarksUrl(basePath, itemId, id), authorization, { method: 'DELETE' }))
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
    return accepted(await ask(fetchImpl, highlightsUrl(basePath, itemId), authorization), listOf(isHighlight))
}

// True for the server's answer that the user already keeps the most bookmarks or highlights it allows.
const limitReached = async (response: Response | string): Promise<boolean> =>
    typeof response !== 'string' && response.status === 409 && await reasonOf(response) === 'limitReached'

// Sends a highlight change; the highlight as stored, or null when that failed.
const sendHighlight = async (url: string, method: string, authorization: string, body: object, fetchImpl: typeof fetch): Promise<Highlight | null | 'limitReached'> => {
    const response = await ask(fetchImpl, url, authorization, { method, json: body })
    if (await limitReached(response)) return 'limitReached'
    return accepted(response, isHighlight)
}

/**
 * Highlights text, with a note; returns the highlight as stored (or the one already there, in this colour and with this note),
 * 'limitReached' when the user already keeps the most highlights allowed, or null when that failed.
 */
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
): Promise<Highlight | null | 'limitReached'> =>
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
    sendHighlight(highlightsUrl(basePath, itemId, id), 'PATCH', authorization, changes, fetchImpl).then(sent => sent === 'limitReached' ? null : sent)

/** Removes a highlight; returns whether it is gone (true too when the server had it no longer). */
export const removeHighlight = async (
    basePath: string,
    itemId: string,
    authorization: string,
    id: string,
    fetchImpl: typeof fetch = fetch,
): Promise<boolean> => {
    return gone(await ask(fetchImpl, highlightsUrl(basePath, itemId, id), authorization, { method: 'DELETE' }))
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
    return accepted(await ask(fetchImpl, highlightersUrl(basePath), authorization), listOf(isHighlighterRecord))
}

/** Keeps the user's whole list of highlighters (a new one without an id); returns them as kept, or null when that failed. */
export const saveHighlighters = async (
    basePath: string,
    authorization: string,
    list: { id?: string, name: string, colour: string }[],
    fetchImpl: typeof fetch = fetch,
): Promise<HighlighterRecord[] | null> => {
    return accepted(await ask(fetchImpl, highlightersUrl(basePath), authorization, { method: 'PUT', json: list }), listOf(isHighlighterRecord))
}

/** One of the user's own themes as Oriel's store keeps it: its id, name and ten colours, each #rrggbb. */
export const isThemeRecord = (value: unknown): value is OwnTheme => {
    const theme = value as Record<string, unknown> | null
    return typeof theme?.id === 'string' && typeof theme.name === 'string'
        && THEME_ROLES.every(([colour]) => typeof theme[colour] === 'string')
}

const themesUrl = (basePath: string): string => `${basePath}/Oriel/Themes`

const choicesUrl = (basePath: string): string => `${basePath}/Oriel/Choices`

const isKeptChoices = (value: unknown): value is KeptChoices => {
    const kept = value as Record<string, unknown> | null
    return !!kept && typeof kept === 'object' && ['theme', 'font'].every(key => kept[key] == null || typeof kept[key] === 'string')
}

/** The theme and font the user has chosen, as the server keeps them, or null when they cannot be read. */
export const readChoices = async (
    basePath: string,
    authorization: string,
    fetchImpl: typeof fetch = fetch,
): Promise<KeptChoices | null> => {
    const data = await accepted(await ask(fetchImpl, choicesUrl(basePath), authorization), isKeptChoices)
    // The server leaves out a choice not made yet.
    return data && { theme: data.theme ?? null, font: data.font ?? null }
}

/**
 * Keeps the theme and font the user has chosen: true once the server has
 * them, or refused them as ones the user no longer has; false while it
 * cannot be reached; 'signedOut' when the session has ended.
 */
export const saveChoices = async (
    basePath: string,
    authorization: string,
    choices: Choices,
    fetchImpl: typeof fetch = fetch,
): Promise<boolean | 'signedOut'> => {
    const response = await ask(fetchImpl, choicesUrl(basePath), authorization, { method: 'PUT', json: choices })
    if (typeof response === 'string') return false
    if (response.status === 401) return 'signedOut'
    return response.ok || (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429)
}

/** The user's own themes in their order, or null when they cannot be read. */
export const readThemes = async (
    basePath: string,
    authorization: string,
    fetchImpl: typeof fetch = fetch,
): Promise<OwnTheme[] | null> => {
    return accepted(await ask(fetchImpl, themesUrl(basePath), authorization), listOf(isThemeRecord))
}

/** Keeps the user's whole list of themes (a new one without an id); returns them as kept, or null when that failed. */
export const saveThemes = async (
    basePath: string,
    authorization: string,
    list: (Omit<OwnTheme, 'id'> & { id?: string })[],
    fetchImpl: typeof fetch = fetch,
): Promise<OwnTheme[] | null> => {
    return accepted(await ask(fetchImpl, themesUrl(basePath), authorization, { method: 'PUT', json: list }), listOf(isThemeRecord))
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
    return accepted(await ask(fetchImpl, fontsUrl(basePath), authorization), listOf(isOwnFont))
}

/** Why a font file was not added: too large, not a font, one too many, past the user's 100 MB, uploads off on the server, or anything else. */
export type FontRefusal = 'tooLarge' | 'notAFont' | 'tooMany' | 'quotaFull' | 'uploadsOff' | 'failed'

/** Adds a font file; returns it as kept, or why it was refused. */
export const addFont = async (
    basePath: string,
    authorization: string,
    file: Blob,
    fetchImpl: typeof fetch = fetch,
): Promise<OwnFont | FontRefusal> => {
    const response = await ask(fetchImpl, fontsUrl(basePath), authorization, { method: 'POST', file: { body: file, type: 'application/octet-stream' } })
    if (typeof response === 'string') return 'failed'
    if (response.status === 413) return 'tooLarge'
    if (response.status === 403) return 'uploadsOff'
    if (response.status === 400) {
        const reason = await reasonOf(response)
        return reason === 'tooMany' || reason === 'notAFont' || reason === 'quotaFull' ? reason : 'failed'
    }
    return await accepted(response, isOwnFont) ?? 'failed'
}

/** One of the user's font files, or null when it cannot be read. */
export const readFontFile = async (
    basePath: string,
    authorization: string,
    id: string,
    fetchImpl: typeof fetch = fetch,
): Promise<Blob | null> => {
    const response = await ask(fetchImpl, `${fontsUrl(basePath)}/${encodeURIComponent(id)}`, authorization)
    return typeof response !== 'string' && response.ok ? response.blob().catch(() => null) : null
}

/** Removes every file of one of the user's font families; false when that failed. */
export const removeFontFamily = async (
    basePath: string,
    authorization: string,
    family: string,
    fetchImpl: typeof fetch = fetch,
): Promise<boolean> => {
    return gone(await ask(fetchImpl, `${fontsUrl(basePath)}?family=${encodeURIComponent(family)}`, authorization, { method: 'DELETE' }))
}

/** What the admin has set for every reader: the translation address, with {text} where the text goes, empty when Translate is off, and whether readers may add fonts. */
export interface ReaderSettings {
    translateUrl: string
    fontUploads: boolean
}

/** The admin's settings for every reader, or null when they cannot be read. */
export const readReaderSettings = async (
    basePath: string,
    authorization: string,
    fetchImpl: typeof fetch = fetch,
): Promise<ReaderSettings | null> => {
    const data = await accepted(await ask(fetchImpl, `${basePath}/Oriel/ReaderSettings`, authorization),
        (value): value is Partial<ReaderSettings> & { translateUrl: string } => typeof (value as Partial<ReaderSettings> | null)?.translateUrl === 'string')
    return data && { translateUrl: data.translateUrl, fontUploads: data.fontUploads === true }
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
    const response = await ask(fetchImpl, `${basePath}/Oriel/Dictionary?word=${encodeURIComponent(word)}`, authorization)
    if (typeof response !== 'string' && response.status === 404) return { missing: true }
    const data = await accepted(response, (value): value is Definition => {
        const definition = value as Partial<Definition> | null
        return typeof definition?.word === 'string' && Array.isArray(definition.entries) && definition.entries.length > 0 && definition.entries.every(isDictionaryEntry)
    })
    return data ? { found: { word: data.word, entries: data.entries } } : { failed: true }
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
    const response = await ask(fetchImpl, `${basePath}/Oriel/Export`, authorization)
    if (typeof response === 'string') return { ok: false, reason: response }
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` }
    const fileName = attachmentName(response.headers.get('Content-Disposition')) ?? DEFAULT_EXPORT_NAME
    return response.blob().then(
        (blob): ReadingDataFile => ({ ok: true, blob, fileName }),
        (error: unknown): ReadingDataFile => ({ ok: false, reason: error instanceof Error ? error.message : String(error) }))
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
    const response = await ask(fetchImpl, `${basePath}/Oriel/Import`, authorization, { method: 'POST', file: { body: file, type: 'application/json' } })
    if (typeof response === 'string') return { kind: 'failed', reason: response }
    if (response.status === 400) return { kind: 'rejected' }
    if (!response.ok) return { kind: 'failed', reason: `HTTP ${response.status}` }
    return response.json().then(
        (result: unknown): ImportOutcome => isImportResult(result) ? { kind: 'done', result } : { kind: 'failed', reason: 'an unexpected reply' },
        (error: unknown): ImportOutcome => ({ kind: 'failed', reason: error instanceof Error ? error.message : String(error) }))
}
