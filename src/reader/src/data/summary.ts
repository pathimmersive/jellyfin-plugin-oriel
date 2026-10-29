// What the Your reading data page says about an import, and where its Back to
// the book link leads. Plain rules, kept apart from the page so they can be
// tested.

/** A book in an imported file that matched none the user can see. */
export interface UnmatchedBook {
    title: string | null
    authors: string[]
    fileName: string | null
}

/** What /Oriel/Import reports. */
export interface ImportResult {
    imported: number
    kept: number
    unmatched: UnmatchedBook[]
}

/** The Import finished panel's text; a line with nothing to report is null. */
export interface ImportSummary {
    imported: string | null
    kept: string | null
    unmatchedLead: string | null
    unmatched: { title: string, detail: string }[]
}

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** The panel's lines for an import result. */
export const summarizeImport = (result: ImportResult): ImportSummary => ({
    imported: result.imported > 0 ? `${count(result.imported, 'place', 'places')} imported` : null,
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
