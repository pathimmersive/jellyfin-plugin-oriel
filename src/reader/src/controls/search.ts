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

