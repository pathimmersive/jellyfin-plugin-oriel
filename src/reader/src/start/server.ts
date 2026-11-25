/** The server the reader reads from and saves to, as whom, and the book read. */
export interface ReaderServer {
    basePath: string
    authorization: string
    userId: string
    itemId: string
    /** Every request goes through this, so a session that ends is noticed. */
    fetch: typeof fetch
}
