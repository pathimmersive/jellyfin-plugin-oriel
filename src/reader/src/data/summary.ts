// What the Your reading data page says about an import, and where its Back to
// the book link leads. Plain rules, kept apart from the page so they can be
// tested.

/** A book in an imported file that matched none the user can see. */
export interface UnmatchedBook {
    title: string | null
    authors: string[]
    fileName: string | null
}

/** What /Oriel/Import reports; a server before a kind was added leaves its count out. */
export interface ImportResult {
    imported: number
    kept: number
    unmatched: UnmatchedBook[]
    bookmarks?: number
    highlights?: number
    highlighters?: number
    themes?: number
    fonts?: number
}

/** The Import finished panel's text; a line with nothing to report is null. */
export interface ImportSummary {
    imported: string | null
    kept: string | null
    unmatchedLead: string | null
    unmatched: { title: string, detail: string }[]
}

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

// "a", "a and b", "a, b and c".
const list = (items: string[]): string =>
    items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`

// Each kind an import adds, in the order the panel names them.
const KINDS: [keyof ImportResult, string, string][] = [
    ['imported', 'place', 'places'],
    ['bookmarks', 'bookmark', 'bookmarks'],
    ['highlights', 'highlight', 'highlights'],
    ['highlighters', 'highlighter', 'highlighters'],
    ['themes', 'theme', 'themes'],
    ['fonts', 'font', 'fonts'],
]

/** The panel's lines for an import result. */
export const summarizeImport = (result: ImportResult): ImportSummary => ({
    imported: ((added: string[]) => added.length ? `${list(added)} imported` : null)(
        KINDS.flatMap(([kind, one, many]) => {
            const n = result[kind]
            return typeof n === 'number' && n > 0 ? [count(n, one, many)] : []
        })),
    kept: result.kept > 0
        ? `${result.kept} kept as ${result.kept === 1 ? 'it was' : 'they were'}, because you had read further on this server`
        : null,
    unmatchedLead: result.unmatched.length > 0
        ? (result.unmatched.length === 1
            ? '1 book is not in your library here, so its place was not imported:'
            : `${result.unmatched.length} books are not in your library here, so their places were not imported:`)
        : null,
    unmatched: result.unmatched.map(book => ({
        title: book.title || book.fileName || 'A book with no title',
        detail: [book.authors.join(', '), book.fileName ?? ''].filter(Boolean).join(' · '),
    })),
})

/** Whether a parsed /Oriel/Import response has the shape the page reads. */
export const isImportResult = (value: unknown): value is ImportResult => {
    const result = value as Partial<ImportResult> | null
    return typeof result?.imported === 'number' && typeof result.kept === 'number' && Array.isArray(result.unmatched)
        && result.unmatched.every(book => Array.isArray(book?.authors))
}

const ITEM_ID = /^[0-9a-f]{32}$/i

/** The book id the page was opened with, when it is a Jellyfin item id. */
export const bookId = (search: string): string | null => {
    const id = new URLSearchParams(search).get('id')
    return id && ITEM_ID.test(id) ? id : null
}

/**
 * Where Back to the book leads: the book in Oriel when the page was opened for
 * one, else the Jellyfin home page, under any BaseUrl.
 */
export const backHref = (basePath: string, itemId: string | null): string =>
    itemId ? `${basePath}/Oriel/?id=${encodeURIComponent(itemId)}` : `${basePath}/web/`
