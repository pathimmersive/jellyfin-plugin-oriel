import { serverBasePath } from '../base'
import { type Failure, showFailure } from '../controls/failure'

/** The page's status line, which the failure page takes as its title. */
export const status = document.getElementById('status')!
/** Where the book is shown. */
export const book = document.getElementById('book')!

/** Reports what the page is doing: data-state on <body> is loading, rendered or error. */
export const show = (state: string, message = ''): void => {
    document.body.dataset.state = state
    status.textContent = message
}

/** The failure page in place of the book, with Back to Jellyfin to its home. */
export const showFailed = (failure: Failure, retry: () => void): void => {
    showFailure(status, failure, retry, `${serverBasePath(location.pathname)}/web/#/home`)
    document.body.dataset.state = 'error'
}
