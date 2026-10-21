import './reader.css'
import { BookLoadError, downloadBook } from './api/client'
import { serverBasePath } from './base'
import { debugRequested } from './debug/frames'
import { DebugOverlay } from './debug/overlay'
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

    const overlay = debugRequested(location.search) ? new DebugOverlay(document.body) : null
    show('loading', 'Loading the book…')
    let stage = 'downloaded'
    try {
        const authorization = authorizationHeader(session, deviceId(localStorage), __ORIEL_VERSION__)
        const started = performance.now()
        const file = await downloadBook(serverBasePath(location.pathname), itemId, authorization)
        const downloaded = performance.now()
        overlay?.set('download', `download ${Math.round(downloaded - started)} ms · ${(file.size / 1048576).toFixed(1)} MB`)
        stage = 'opened'
        await openBook(book, file, view => overlay?.timeTurns(view))
        overlay?.set('open', `first page ${Math.round(performance.now() - downloaded)} ms after download`)
        show('rendered')
    } catch (error) {
        console.error(error)
        // Name the failing step and the browser's own error, so a failure on a
        // device without developer tools can still be diagnosed.
        show('error', error instanceof BookLoadError
            ? error.message
            : `The book could not be ${stage}. ${describe(error)}`)
    }
}

const describe = (error: unknown): string =>
    error instanceof Error ? `${error.name}: ${error.message}` : String(error)

void start()
