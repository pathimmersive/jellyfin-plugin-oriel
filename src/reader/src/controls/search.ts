/** A match in the book: where it is, and the text before it, the match itself and the text after it. */
export interface SearchMatch {
    cfi: string
    pre: string
    match: string
    post: string
}

/** A section's matches, with the name of the contents entry it starts in (empty for none). */
export interface SearchSection {
    label: string
    matches: SearchMatch[]
}

/** Search in this book, as the controls drive it. */
export interface BookSearch {
    /**
     * Searches the book's text for `query`: each section's matches as it is
     * searched. The matches are marked on the page until `clear` or the next
     * search; stopping early stops the search.
     */
    run(query: string): AsyncIterable<SearchSection>
    /** Clears the marks on the page. */
    clear(): void
    /** Goes to a match, as a reader move. */
    go(cfi: string): Promise<void>
}

/** What a search with no matches says first. */
export const noMatches = (query: string): string => `No matches for “${query}” in this book.`


/** What foliate-js's search gives: a section's matches, how far it has got, or that it is done. */
export type FoliateFound =
    | { label: string, subitems: { cfi: string, excerpt: { pre: string, match: string, post: string } }[] }
    | { progress: number }
    | 'done'

/**
 * Each section of a foliate-js search, as the controls read it. A section
 * searched with no matches comes through empty, so a search the reader has
 * replaced or cleared stops at the next section instead of searching on.
 */
export async function* sectionsOf(found: AsyncIterable<FoliateFound>): AsyncGenerator<SearchSection> {
    for await (const item of found) {
        if (item === 'done') continue
        // foliate-js gives each section's progress before its matches: an empty section to the reader.
        if (!('subitems' in item)) {
            yield { label: '', matches: [] }
            continue
        }
        yield { label: item.label.trim(), matches: item.subitems.map(({ cfi, excerpt }) => ({ cfi, ...excerpt })) }
    }
}
