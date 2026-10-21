import './reader.css'
import { BookLoadError, downloadBook } from './api/client'
import { serverBasePath } from './base'
import { openBook } from './engine/engine'
import { authorizationHeader, deviceId, loginUrl, readSession } from './session/credentials'

declare const __ORIEL_VERSION__: string

const status = document.getElementById('status')!
const book = document.getElementById('book')!

// data-state on <body> is what the page reports: loading, rendered or error.
const show = (state: string, message = ''): void => {
    document.body.dataset.state = state
    status.textContent = message
}

const start = async (): Promise<void> => {
    const session = readSession(localStorage, location.origin)
    if (!session) {
        location.replace(loginUrl(location.pathname))
        return
    }

    const itemId = new URLSearchParams(location.search).get('id')
    if (!itemId) {
        show('error', 'No book was chosen. Open a book from your Jellyfin library.')
        return
    }

    show('loading', 'Loading the book…')
    try {
        const authorization = authorizationHeader(session, deviceId(localStorage), __ORIEL_VERSION__)
        const file = await downloadBook(serverBasePath(location.pathname), itemId, authorization)
        await openBook(book, file)
        show('rendered')
    } catch (error) {
        console.error(error)
        show('error', error instanceof BookLoadError ? error.message : 'The book could not be opened.')
    }
}

void start()
