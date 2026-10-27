import './reader.css'
import { BookLoadError, downloadBook, publicServerId, readJellyfinPosition, readStoredPosition, writeJellyfinPosition, writeStoredPosition } from './api/client'
import { serverBasePath } from './base'
import { debugRequested } from './debug/frames'
import { DebugOverlay } from './debug/overlay'
import { openBook } from './engine/engine'
import { chooseStart, positionWriter, saveBoth } from './position/position'
import { authorizationHeader, deviceId, loginUrl, readSession } from './session/credentials'
import { saveReturnMarker } from './session/return'

declare const __ORIEL_VERSION__: string

const status = document.getElementById('status')!
const book = document.getElementById('book')!

// data-state on <body> is what the page reports: loading, rendered or error.
const show = (state: string, message = ''): void => {
    document.body.dataset.state = state
    status.textContent = message
}

const start = async (): Promise<void> => {
    const itemId = new URLSearchParams(location.search).get('id')
    const session = readSession(localStorage, location.origin)
    if (!session) {
        // Sign in on the jellyfin-web login page, then come back to this book.
        saveReturnMarker(localStorage, itemId)
        location.replace(loginUrl(location.pathname, itemId, await publicServerId(serverBasePath(location.pathname))))
        return
    }

    if (!itemId) {
        show('error', 'No book was chosen. Open a book from your Jellyfin library.')
        return
    }

    const overlay = debugRequested(location.search) ? new DebugOverlay(document.body) : null
    show('loading', 'Loading the book…')
    let stage = 'downloaded'
    try {
        const authorization = authorizationHeader(session, deviceId(localStorage), __ORIEL_VERSION__)
        const basePath = serverBasePath(location.pathname)
        const started = performance.now()
        const [file, stored, jellyfin] = await Promise.all([
            downloadBook(basePath, itemId, authorization),
            readStoredPosition(basePath, itemId, authorization),
            readJellyfinPosition(basePath, itemId, session.userId, authorization),
        ])
        const downloaded = performance.now()
        overlay?.set('download', `download ${Math.round(downloaded - started)} ms · ${(file.size / 1048576).toFixed(1)} MB`)
        stage = 'opened'
        const start = chooseStart(stored, jellyfin)
        const opened = await openBook(book, file, view => overlay?.timeTurns(view), start)
        overlay?.set('open', `first page ${Math.round(performance.now() - downloaded)} ms after download`)
        show('rendered')

        // Save the exact position to Oriel's store and the approximate one to
        // Jellyfin, so Resume, Continue Reading and the built-in reader pick up
        // where reading stopped here.
        const writer = positionWriter(
            (position, keepalive) => saveBoth(position, keepalive,
                (cfi, fraction, keep) => writeStoredPosition(basePath, itemId, authorization, cfi, fraction, keep),
                (ticks, lastPlayed, keep) => writeJellyfinPosition(basePath, itemId, session.userId, authorization, ticks, lastPlayed, keep)),
            start && 'cfi' in start ? start.cfi : null)
        opened.onMoved(position => writer.moved(position))
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') writer.flush()
        })
        window.addEventListener('pagehide', () => writer.flush())
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
