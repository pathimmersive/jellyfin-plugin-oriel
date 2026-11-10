import './reader.css'
import { addBookmark, addFont, addHighlight, downloadBook, type JellyfinPosition, publicServerId, readBookDetails, readBookmarks, readFontFile, readFonts, readHighlighters, readHighlights, readJellyfinPosition, readReaderSettings, readStoredPosition, readThemes, lookUpWord, removeBookmark, removeFontFamily, removeHighlight, saveHighlighters, saveThemes, type StoredPosition, updateHighlight, writeJellyfinPosition, writeStoredPosition } from './api/client'
import { serverBasePath } from './base'
import { createBookmarks } from './controls/bookmarks'
import { contentsRows } from './controls/contents'
import { type Controls, createControls } from './controls/controls'
import { createDictionarySheet, type DictionarySheet } from './controls/dictionary'
import { createOwnFonts } from './controls/fonts'
import { createOwnThemes } from './controls/themes'
import { clearFailure, DrmError, type Failure, failureFor, ICONS, NOTICE_TEXT, saveNotice, showFailure } from './controls/failure'
import { createHighlighterSheet, type HighlighterSheet } from './controls/highlighter-sheet'
import { createHighlighters } from './controls/highlighters'
import { createHighlights } from './controls/highlights'
import { lastInput } from './controls/hint'
import { layoutKey, type PageCount, pageNumber, progressShown, type ProgressShown, readCount, writeCount } from './controls/progress'
import { createCopy, createHighlighting, type Highlighting } from './controls/toolbar'
import { debugRequested } from './debug/frames'
import { DebugOverlay } from './debug/overlay'
import { drmProtected } from './engine/drm'
import { openBook } from './engine/engine'
import { loadingScreen } from './loading/loading'
import { chooseStart, fallbackStart, missingPlaceNotice, positionWriter, saveBoth } from './position/position'
import { authorizationHeader, deviceId, loginUrl, readSession } from './session/credentials'
import { saveReturnMarker } from './session/return'
import { fontFaces } from './settings/fonts'
import { bookStyles, controlsColours, landscapeMargins, type Margins, marginsFor, ownFamilyOf, type OwnTheme, pageColours, readSettings, type Settings, themeShown, writeSettings } from './settings/settings'

declare const __ORIEL_VERSION__: string

const status = document.getElementById('status')!
// The panel beside the page on a desktop, as reader.css draws it.
const PANEL_WIDTH = 440
const book = document.getElementById('book')!

// data-state on <body> is what the page reports: loading, rendered or error.
const show = (state: string, message = ''): void => {
    document.body.dataset.state = state
    status.textContent = message
}

// The page around the book takes the theme: its background and the reading
// footer's colour, and with a custom theme the controls' colours too.
const themePage = (settings: Settings, own: readonly OwnTheme[] = []): void => {
    const shown = themeShown(settings.theme, own)
    const theme = pageColours(shown)
    const root = document.documentElement
    root.style.setProperty('--page-background', theme.background)
    root.style.setProperty('--page-footer', theme.footer)
    const controls = typeof shown === 'string' ? null : controlsColours(shown)
    for (const name of ['--chrome', '--chrome-ink', '--sub', '--accent', '--accent-ink', '--divider', '--raised', '--grayed']) {
        if (controls) root.style.setProperty(name, controls[name])
        else root.style.removeProperty(name)
    }
    root.toggleAttribute('data-own-theme', !!controls)
}

// Signs in on the jellyfin-web login page, then comes back to this book.
const signIn = async (itemId: string | null): Promise<void> => {
    saveReturnMarker(localStorage, itemId)
    location.replace(loginUrl(location.pathname, itemId, await publicServerId(serverBasePath(location.pathname))))
}

// The failure page in place of the book, with Back to Jellyfin to its home.
const showFailed = (failure: Failure, retry: () => void): void => {
    showFailure(status, failure, retry, `${serverBasePath(location.pathname)}/web/#/home`)
    document.body.dataset.state = 'error'
}

// Resolves when it is time to ask an unreachable server again: after 5
// seconds, when the browser comes back online, or on Try again.
const untilRetry = (): { retry: () => void, due: Promise<void> } => {
    let retry = (): void => {}
    const due = new Promise<void>(resolve => {
        const timer = window.setTimeout(() => retry(), 5000)
        retry = () => {
            clearTimeout(timer)
            window.removeEventListener('online', retry)
            resolve()
        }
        window.addEventListener('online', retry)
    })
    return { retry, due }
}

const start = async (): Promise<void> => {
    const itemId = new URLSearchParams(location.search).get('id')
    const session = readSession(localStorage, location.origin)
    if (!session) {
        await signIn(itemId)
        return
    }

    if (!itemId) {
        showFailed({ kind: 'other', title: 'No book was chosen.', body: 'Open a book from your Jellyfin library.', retry: false }, () => {})
        return
    }

    // The settings kept on this device, applied before the first page shows.
    // The bundled fonts are declared here too, for Preferences' font buttons.
    let settings = readSettings(localStorage)
    let faces = fontFaces()
    const fontStyle = document.createElement('style')
    fontStyle.textContent = faces
    document.head.append(fontStyle)
    themePage(settings)
    // A phone or a wider screen, for the margins the reader has not changed.
    const wide = matchMedia('(min-width: 600px)')
    // A desktop, where a panel opens beside the book and the book moves clear of it.
    const desk = matchMedia('(min-width: 600px) and (min-height: 501px)')
    // A phone on its side, where the book is one column clear of the notch.
    const sideways = matchMedia('(orientation: landscape) and (max-height: 500px)')
    const marginsShown = (): Margins => {
        if (!sideways.matches) return marginsFor(settings, wide.matches)
        const area = getComputedStyle(book)
        return landscapeMargins(settings, { left: parseFloat(area.left) || 0, right: parseFloat(area.right) || 0 })
    }

    const overlay = debugRequested(location.search) ? new DebugOverlay(document.body) : null
    show('loading', 'Loading the book…')
    let stage = 'downloaded'
    try {
        const authorization = authorizationHeader(session, deviceId(localStorage), __ORIEL_VERSION__)
        const basePath = serverBasePath(location.pathname)
        const started = performance.now()
        // The loading screen's title and cover come beside the download, and
        // the download's progress as its bytes arrive.
        const screen = loadingScreen(document.getElementById('loading')!)
        void readBookDetails(basePath, itemId, session.userId, authorization).then(screen.details)
        // While the server cannot be reached the failure page says so, and the
        // book and its saved places are asked for again until it answers.
        let fetched: [File, StoredPosition | null, JellyfinPosition | null]
        for (;;) {
            try {
                fetched = await Promise.all([
                    downloadBook(basePath, itemId, authorization, fetch, screen.progress),
                    readStoredPosition(basePath, itemId, authorization),
                    readJellyfinPosition(basePath, itemId, session.userId, authorization),
                ])
                break
            } catch (error) {
                const failure = failureFor(error, stage)
                if (failure === 'signIn' || failure.kind !== 'offline') throw error
                const { retry, due } = untilRetry()
                showFailed(failure, retry)
                await due
            }
        }
        const [file, stored, jellyfin] = fetched
        clearFailure(status)
        show('loading', 'Opening the book…')
        screen.opening()
        if (await drmProtected(file)) throw new DrmError()

        // The reader's own fonts, declared like the bundled ones before the
        // first page shows. A chosen family the reader no longer has goes
        // back to Default.
        const ownFonts = createOwnFonts({
            load: () => readFonts(basePath, authorization),
            add: font => addFont(basePath, authorization, font),
            file: id => readFontFile(basePath, authorization, id),
            remove: family => removeFontFamily(basePath, authorization, family),
            url: font => URL.createObjectURL(font),
            forget: url => URL.revokeObjectURL(url),
        })
        const declareFonts = (): void => {
            faces = [fontFaces(), ownFonts.faces()].filter(Boolean).join('\n')
            fontStyle.textContent = faces
        }
        // The reader's own themes, applied before the first page shows.
        const ownThemes = createOwnThemes({
            load: () => readThemes(basePath, authorization),
            save: list => saveThemes(basePath, authorization, list),
        })
        const styles = (chosen: Settings): string => bookStyles(chosen, faces, ownThemes.list())
        const chosenFamily = ownFamilyOf(settings.font)
        const [fontsRead] = await Promise.all([ownFonts.ready, ownThemes.ready])
        themePage(settings, ownThemes.list())
        if (fontsRead && chosenFamily !== null && !ownFonts.has(chosenFamily)) {
            settings = { ...settings, font: 'Default' }
            writeSettings(localStorage, settings)
        }
        declareFonts()
        const downloaded = performance.now()
        overlay?.set('download', `download ${Math.round(downloaded - started)} ms · ${(file.size / 1048576).toFixed(1)} MB`)
        stage = 'opened'
        const start = chooseStart(stored, jellyfin)
        let controls: Controls | null = null
        let highlighting: Highlighting | null = null
        let dictionary: DictionarySheet | null = null
        // The reading gestures hint follows the reader's last input, in this page and in the book's own documents.
        const input = lastInput(() => matchMedia('(pointer: coarse)').matches)
        input.watch(window)
        // The book's section windows, for Escape in highlighting and the Dictionary sheet once they exist.
        const sectionWindows: Window[] = []
        const watchSections = (view: EventTarget): void => view.addEventListener('load', event => {
            const win = (event as CustomEvent<{ doc: Document }>).detail.doc.defaultView
            if (!win) return
            input.watch(win)
            sectionWindows.push(win)
            highlighting?.watch(win)
            dictionary?.watch(win)
        })
        // A page turn hides the controls and closes the Selected text toolbar.
        const turned = (): void => {
            controls?.turned()
            highlighting?.close()
        }
        const opened = await openBook(book, file, view => { watchSections(view); overlay?.timeTurns(view) }, start,
            () => controls?.middle(), turned, styles(settings), marginsShown(), settings.pageTurn, sideways.matches)
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

        // Highlights, in a book with text: drawn on the page, made and changed
        // from the Selected text toolbar, and listed in the Contents panel.
        const highlights = opened.fixedLayout ? null : createHighlights({
            load: () => readHighlights(basePath, itemId, authorization),
            add: (cfi, fraction, colour, text, note) => addHighlight(basePath, itemId, authorization, cfi, fraction, colour, text, note),
            update: (id, change) => updateHighlight(basePath, itemId, authorization, id, change),
            remove: id => removeHighlight(basePath, itemId, authorization, id),
            compare: (a, b) => opened.compare(a, b),
            chapterOf: cfi => opened.chapterOf(cfi),
            pageOf: cfi => pageOf(cfi),
            go: cfi => opened.goTo(cfi),
        })
        // The reader's highlighters, kept on the server, with the sheet that adds and edits them.
        const highlighters = highlights && createHighlighters({
            load: () => readHighlighters(basePath, authorization),
            save: list => saveHighlighters(basePath, authorization, list),
        })
        let highlighterSheet: HighlighterSheet | null = null
        if (highlights && highlighters) {
            highlighterSheet = createHighlighterSheet(document.body, highlighters)
            // What the admin has set for every reader: the translation address.
            let translateUrl = ''
            void readReaderSettings(basePath, authorization).then(settings => { translateUrl = settings?.translateUrl ?? '' })
            const search = opened.searchable ? (query: string) => controls?.search(query) : null
            const copy = createCopy(document.body)
            // Define's sheet, with the dictionary on the server.
            const sheet = createDictionarySheet(document.body, {
                lookUp: word => lookUpWord(basePath, authorization, word),
                search,
                copy,
            })
            highlighting = createHighlighting(document.body, opened, highlights, highlighters, highlighterSheet, () => wide.matches, {
                title: opened.title,
                translateUrl: () => translateUrl,
                search,
                copy,
                define: text => sheet.open(text),
            }, input.touch)
            dictionary = sheet
            for (const win of sectionWindows) {
                highlighting.watch(win)
                sheet.watch(win)
            }
        }

        const bookmarks = createBookmarks({
            load: () => readBookmarks(basePath, itemId, authorization),
            add: (cfi, fraction, text) => addBookmark(basePath, itemId, authorization, cfi, fraction, text),
            remove: id => removeBookmark(basePath, itemId, authorization, id),
            page: () => opened.page(),
            onPage: cfi => opened.onPage(cfi),
            chapterOf: cfi => opened.chapterOf(cfi),
            pageOf: cfi => pageOf(cfi),
            go: cfi => opened.goTo(cfi),
        })

        // The reader's controls: a tap in the middle of the page shows them
        // and a page turn hides them; a move with their slider, or a turn
        // with their arrows on a desktop, keeps them.
        // Whether a panel is open beside the page, and whether the book is laid
        // out beside it. The book's pages are those of its layout without the
        // panel: while it lays out beside one, the count and the page numbers
        // shown stay those of the layout without it.
        let panelOpen = false
        const beside = (): boolean => panelOpen && desk.matches
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
            search: opened.searchable
                ? { run: query => opened.search(query), clear: () => opened.clearSearch(), go: cfi => opened.goTo(cfi) }
                : null,
            bookmarks,
            highlights,
            highlighters,
            highlighterSheet,
            fonts: ownFonts,
            themes: ownThemes,
            settings,
            fixedLayout: opened.fixedLayout,
            wide: () => wide.matches,
            touch: input.touch,
            storage: localStorage,
            change(changed) {
                const restyle = styles(changed) !== styles(settings)
                settings = changed
                writeSettings(localStorage, settings)
                themePage(settings, ownThemes.list())
                if (restyle) opened.setStyles(styles(settings))
                opened.setMargins(marginsShown())
                opened.setPageTurn(settings.pageTurn)
                recount()
            },
            turnPage: direction => opened.turnPage(direction),
            edges: () => opened.edges(),
            panel: open => {
                // The bookmarks and highlights on the page shown are placed first, in the layout without the panel.
                if (open) for (const cfi of marked()) pageOf(cfi)
                panelOpen = open
                opened.setPanel(beside() ? PANEL_WIDTH : 0)
                recount()
                showPlace()
            },
        })
        const turnedOver = (): void => {
            opened.setOneColumn(sideways.matches)
            opened.setMargins(marginsShown())
        }
        wide.addEventListener('change', turnedOver)
        sideways.addEventListener('change', turnedOver)
        desk.addEventListener('change', () => {
            opened.setPanel(beside() ? PANEL_WIDTH : 0)
            recount()
            showPlace()
        })
        ownFonts.onChange(() => {
            declareFonts()
            opened.setStyles(styles(settings))
            recount()
        })
        // A theme edited or deleted recolours the reader at once.
        ownThemes.onChange(() => {
            themePage(settings, ownThemes.list())
            opened.setStyles(styles(settings))
        })
        const shown = controls
        // Beside a panel the chapter and percent follow the place, and the page
        // number stays the last one shown while the place has not moved.
        let lastShown: { fraction: number, progress: ProgressShown, left: number | null } | null = null
        const showPlace = (): void => {
            const { chapter, fraction, pages } = opened.place()
            if (beside()) {
                const same = lastShown !== null && Math.abs(lastShown.fraction - fraction) < 0.005
                shown.locate(chapter, fraction, same ? lastShown!.progress : progressShown('percent', fraction, null, null), same ? lastShown!.left : null)
                return
            }
            const progress = progressShown(settings.progress, fraction, count, pages)
            lastShown = { fraction, progress, left: pages?.left ?? null }
            shown.locate(chapter, fraction, progress, lastShown.left)
        }
        opened.onPlace(showPlace)

        // Pages mode counts the book for its layout, in the background; a
        // count kept from before for the same layout is used at once.
        // The count places the bookmarks and highlights too. `force` counts
        // again for places the count has not tried, keeping the count shown
        // until the new one lands.
        let count: PageCount | null = null
        let counting: { cancelled: boolean } | null = null
        let countedFor = ''
        const tried = new Set<string>()
        const marked = (): string[] => [...bookmarks.places(), ...(highlights?.all().map(highlight => highlight.cfi) ?? [])]
        function recount(force = false): void {
            if (beside()) return
            const key = settings.progress === 'pages' && !opened.fixedLayout ? layoutKey(opened.layout()) : ''
            if (!force && key === countedFor && (count || counting)) return
            if (counting) counting.cancelled = true
            counting = null
            if (!force || key !== countedFor) count = null
            countedFor = key
            if (key) {
                count ??= force ? null : readCount(localStorage, itemId!, key)
                if (!count || force) {
                    const places = marked()
                    const run = { cancelled: false }
                    counting = run
                    void opened.count(() => run.cancelled, places).then(result => {
                        if (run.cancelled || !result) return
                        counting = null
                        count = result
                        for (const cfi of places) tried.add(cfi)
                        writeCount(localStorage, itemId!, key, result)
                        showPlace()
                        shown.refill()
                        placeMarked()
                    }).catch(error => console.error('counting pages', error))
                } else {
                    placeMarked()
                }
            }
            showPlace()
            shown.refill()
        }
        // The page a bookmark or highlight is on: from the count, or, for one
        // made since on the section shown, from the layout on screen.
        function pageOf(cfi: string): number | null {
            if (settings.progress !== 'pages' || !count) return null
            const kept = count.entries[cfi]
            if (kept) return kept
            if (beside()) return null
            const here = opened.pageShown(cfi)
            if (!here || here.section >= count.sections.length) return null
            count.entries[cfi] = pageNumber(count, here.section, here.page)
            writeCount(localStorage, itemId!, countedFor, count)
            return count.entries[cfi]
        }
        // Counts again for bookmarks and highlights the count has not placed:
        // ones loaded after it, or added on another device.
        function placeMarked(): void {
            if (!count || counting) return
            const counted = count
            if (marked().some(cfi => !counted.entries[cfi] && !tried.has(cfi) && !opened.pageShown(cfi))) recount(true)
        }
        bookmarks.onChange(placeMarked)
        highlights?.onChange(placeMarked)
        recount()
        let resized = 0
        window.addEventListener('resize', () => {
            clearTimeout(resized)
            resized = window.setTimeout(recount, 500)
        })

        // Save the exact position to Oriel's store and the approximate one to
        // Jellyfin, so Resume, Continue Reading and the built-in reader pick up
        // where reading stopped here.
        // A save refused because the session has ended, or failed another way,
        // says so at the bottom of the page: signed out until the page is left,
        // not saved until a save goes through.
        let saveShown: { kind: 'signedOut' | 'notSaved', element: HTMLElement } | null = null
        const placeSaveNotice = (kind: 'signedOut' | 'notSaved' | null): void => {
            if (saveShown?.kind === 'signedOut' || saveShown?.kind === kind) return
            saveShown?.element.remove()
            saveShown = kind && {
                kind,
                element: kind === 'signedOut'
                    ? showNotice(NOTICE_TEXT.signedOut, ICONS.person, { label: 'Sign in', run: () => void signIn(itemId) })
                    : showNotice(NOTICE_TEXT.notSaved, ICONS.cloudOff),
            }
        }
        const writer = positionWriter(
            async (position, keepalive) => {
                let refused = false
                const watched: typeof fetch = async (input, init) => {
                    const response = await fetch(input, init)
                    if (response.status === 401) refused = true
                    return response
                }
                const saved = await saveBoth(position, keepalive,
                    (cfi, fraction, keep) => writeStoredPosition(basePath, itemId, authorization, cfi, fraction, keep, watched),
                    (ticks, lastPlayed, keep) => writeJellyfinPosition(basePath, itemId, session.userId, authorization, ticks, lastPlayed, keep, watched))
                placeSaveNotice(saveNotice(saved, refused ? 401 : null))
                return saved
            },
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
        // The failure page names what failed; for one it cannot name, the step
        // and the browser's own error, so a failure on a device without
        // developer tools can still be diagnosed. An expired session signs in.
        const failure = failureFor(error, stage)
        if (failure === 'signIn') await signIn(itemId)
        else showFailed(failure, () => location.reload())
    }
}

const INFO = 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z'

// A note at the bottom of the page, as the reader's notices are drawn, with an icon and an optional action.
const showNotice = (text: string, icon = INFO, action?: { label: string, run: () => void }): HTMLElement => {
    const notice = document.createElement('div')
    notice.className = 'notice'
    notice.setAttribute('role', 'status')
    notice.innerHTML = `<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="${icon}"/></svg><span></span>`
    notice.querySelector('span')!.textContent = text
    if (action) {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = action.label
        button.addEventListener('click', action.run)
        notice.append(button)
    }
    document.body.append(notice)
    return notice
}

void start()
