/** The server the reader reads from and saves to, as whom, and the book read. */
export interface ReaderServer {
    basePath: string
    authorization: string
    userId: string
    itemId: string
}
