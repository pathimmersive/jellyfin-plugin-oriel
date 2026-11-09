import type { BookDetails } from '../api/client'

// Megabytes of 1,000,000 bytes, to one decimal place.
const megabytes = (bytes: number): string => (bytes / 1_000_000).toFixed(1)

/** The line under the bar while the book downloads: what has arrived, of the size when the server says it. */
export const downloadLine = (done: number, total: number | null): string =>
    total === null
        ? `Downloading · ${megabytes(done)} MB`
        : `Downloading · ${megabytes(Math.min(done, total))} of ${megabytes(total)} MB`

/** The bar's share in whole percent, or null when the size is not known. */
export const downloadShare = (done: number, total: number | null): number | null =>
    total === null ? null : Math.min(100, Math.floor(done / total * 100))

export interface LoadingScreen {
    /** The book's title and cover, once Jellyfin has given them. */
    details: (details: BookDetails | null) => void
    /** Bytes received, of the size when the server says it. */
    progress: (done: number, total: number | null) => void
    /** The file has arrived and the book is being opened. */
    opening: () => void
}

/**
 * The loading screen as the canvas's PhoneLoading and DeskLoading boards draw
 * it: the logo and the book's cover, then its title, a progress bar and the
 * line below it. A bar with no aria-valuenow moves without a share.
 */
export const loadingScreen = (root: HTMLElement): LoadingScreen => {
    const cover = root.querySelector<HTMLImageElement>('.loading-cover')!
    const title = root.querySelector<HTMLElement>('.loading-title')!
    const bar = root.querySelector<HTMLElement>('.loading-bar')!
    const fill = bar.querySelector<HTMLElement>('span')!
    const line = root.querySelector<HTMLElement>('.loading-line')!

    const say = (text: string, share: number | null): void => {
        line.textContent = text
        bar.setAttribute('aria-valuetext', text)
        if (share === null) {
            bar.removeAttribute('aria-valuenow')
            fill.style.width = ''
        } else {
            bar.setAttribute('aria-valuenow', String(share))
            fill.style.width = `${share}%`
        }
    }

    return {
        details: details => {
            if (!details) return
            title.textContent = details.title
            if (details.cover) {
                cover.alt = details.title ? `Cover of ${details.title}` : 'Cover'
                cover.src = details.cover
                cover.hidden = false
            }
        },
        progress: (done, total) => say(downloadLine(done, total), downloadShare(done, total)),
        opening: () => say('Opening the book…', 100),
    }
}
