import './reader.css'
import { BookLoadError, downloadBook, publicServerId, readJellyfinPosition, readStoredPosition, writeJellyfinPosition, writeStoredPosition } from './api/client'
import { serverBasePath } from './base'
import { contentsRows } from './controls/contents'
import { type Controls, createControls } from './controls/controls'
import { layoutKey, type PageCount, progressShown, readCount, writeCount } from './controls/progress'
import { debugRequested } from './debug/frames'
import { DebugOverlay } from './debug/overlay'
import { openBook } from './engine/engine'
import { chooseStart, fallbackStart, missingPlaceNotice, positionWriter, saveBoth } from './position/position'
import { authorizationHeader, deviceId, loginUrl, readSession } from './session/credentials'
import { saveReturnMarker } from './session/return'
import { fontFaces } from './settings/fonts'
import { bookStyles, marginsFor, readSettings, type Settings, THEMES, writeSettings } from './settings/settings'

declare const __ORIEL_VERSION__: string

const status = document.getElementById('status')!
const book = document.getElementById('book')!

// data-state on <body> is what the page reports: loading, rendered or error.
const show = (state: string, message = ''): void => {
    document.body.dataset.state = state
    status.textContent = message
}

// The page around the book takes the theme: its background and the reading footer's colour.
const themePage = (settings: Settings): void => {
    const theme = THEMES[settings.theme]
    document.documentElement.style.setProperty('--page-background', theme.background)
    document.documentElement.style.setProperty('--page-footer', theme.footer)
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

    // The settings kept on this device, applied before the first page shows.
    // The bundled fonts are declared here too, for Preferences' font buttons.
    let settings = readSettings(localStorage)
    const faces = fontFaces()
    const fontStyle = document.createElement('style')
    fontStyle.textContent = faces
    document.head.append(fontStyle)
    themePage(settings)
    // A phone or a wider screen, for the margins the reader has not changed.
    const wide = matchMedia('(min-width: 600px)')

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
        let controls: Controls | null = null
        const opened = await openBook(book, file, view => overlay?.timeTurns(view), start,
            () => controls?.middle(), () => controls?.turned(), bookStyles(settings, faces), marginsFor(settings, wide.matches), settings.pageTurn)
        // A saved place that is not in this copy of the book (another edition,
        // or an import from another server): open somewhere sensible and say so.
        let notice: HTMLElement | null = null
        if (!opened.placed) {
            const fallback = fallbackStart(stored, jellyfin)
            await opened.reopen(fallback.fraction)
            notice = showNotice(missingPlaceNotice(fallback))
        }
        overlay?.set('open', `first page ${Math.round(performance.now() - downloaded)} ms after download`)
        show('rendered')

        // The reader's controls: a tap in the middle of the page shows them
        // and a page turn hides them; a move with their slider keeps them.
        controls = createControls(document.body, {
            title: opened.title,
            detailsUrl: `${basePath}/web/#/details?id=${encodeURIComponent(itemId)}`,
            dataUrl: `${basePath}/Oriel/data.html?id=${encodeURIComponent(itemId)}`,
            seek: fraction => opened.seek(fraction),
            contents: () => {
                const counted = settings.progress === 'pages' ? count : null
                return contentsRows(opened.contents, href => opened.fractionOf(href), opened.place().href,
                    counted && (href => counted.entries[href] ?? null))
            },
            choose: href => opened.goTo(href),
            settings,
            fixedLayout: opened.fixedLayout,
            wide: () => wide.matches,
            touch: () => matchMedia('(pointer: coarse)').matches,
            storage: localStorage,
            change(changed) {
                const restyle = bookStyles(changed, faces) !== bookStyles(settings, faces)
                settings = changed
                writeSettings(localStorage, settings)
                themePage(settings)
                if (restyle) opened.setStyles(bookStyles(settings, faces))
                opened.setMargins(marginsFor(settings, wide.matches))
                opened.setPageTurn(settings.pageTurn)
                recount()
            },
        })
        wide.addEventListener('change', () => opened.setMargins(marginsFor(settings, wide.matches)))
        const shown = controls
        const showPlace = (): void => {
            const { chapter, fraction, pages } = opened.place()
            shown.locate(chapter, fraction, progressShown(settings.progress, fraction, count, pages), pages?.left ?? null)
        }
        opened.onPlace(showPlace)

        // Pages mode counts the book for its layout, in the background; a
        // count kept from before for the same layout is used at once.
        let count: PageCount | null = null
        let counting: { cancelled: boolean } | null = null
        let countedFor = ''
        function recount(): void {
            const key = settings.progress === 'pages' && !opened.fixedLayout ? layoutKey(opened.layout()) : ''
            if (key === countedFor && (count || counting)) return
            if (counting) counting.cancelled = true
            counting = null
            count = null
            countedFor = key
            if (key) {
                count = readCount(localStorage, itemId!, key)
                if (!count) {
                    const run = { cancelled: false }
                    counting = run
                    void opened.count(() => run.cancelled).then(result => {
                        if (run.cancelled || !result) return
                        counting = null
                        count = result
                        writeCount(localStorage, itemId!, key, result)
                        showPlace()
                    }).catch(error => console.error('counting pages', error))
                }
            }
            showPlace()
        }
        recount()
        let resized = 0
        window.addEventListener('resize', () => {
            clearTimeout(resized)
            resized = window.setTimeout(recount, 500)
        })

        // Save the exact position to Oriel's store and the approximate one to
        // Jellyfin, so Resume, Continue Reading and the built-in reader pick up
        // where reading stopped here.
        const writer = positionWriter(
            (position, keepalive) => saveBoth(position, keepalive,
                (cfi, fraction, keep) => writeStoredPosition(basePath, itemId, authorization, cfi, fraction, keep),
                (ticks, lastPlayed, keep) => writeJellyfinPosition(basePath, itemId, session.userId, authorization, ticks, lastPlayed, keep)),
            opened.openedAt)
        opened.onMoved(position => {
            if (notice && position.cfi !== opened.openedAt) {
                notice.remove()
                notice = null
            }
            writer.moved(position)
        })
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

// A note at the bottom of the page, as the reader's notices are drawn.
const showNotice = (text: string): HTMLElement => {
    const notice = document.createElement('div')
    notice.className = 'notice'
    notice.setAttribute('role', 'status')
    notice.innerHTML = '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="currentColor">'
        + '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg><span></span>'
    notice.querySelector('span')!.textContent = text
    document.body.append(notice)
    return notice
}

const describe = (error: unknown): string =>
    error instanceof Error ? `${error.name}: ${error.message}` : String(error)

void start()
