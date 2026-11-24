import './reader.css'
import { readReaderSettings } from './api/client'
import { serverBasePath } from './base'
import { contentsRows } from './controls/contents'
import { type Controls, createControls } from './controls/controls'
import { DrmError, failureFor } from './controls/failure'
import { lastInput } from './controls/hint'
import { readCount, writeCount } from './controls/progress'
import { debugRequested } from './debug/frames'
import { DebugOverlay } from './debug/overlay'
import { drmProtected } from './engine/drm'
import { openBook } from './engine/engine'
import { chooseStart } from './position/position'
import { authorizationHeader, deviceId, readSession } from './session/credentials'
import type { Margins } from './settings/settings'
import { createAppearance } from './start/appearance'
import { fetchBook } from './start/fetch'
import { createBookBookmarks, createTextMarks, type TextMarks } from './start/marks'
import { placeMissing } from './start/missing'
import { chosenOn, ownFontsOn, ownThemesOn } from './start/own'
import { book, show, showFailed } from './start/page'
import { createPageCount } from './start/page-count'
import { createPlaceShown } from './start/place'
import { savePlaces } from './start/saving'
import { createScreens } from './start/screens'
import { createSections } from './start/sections'
import type { ReaderServer } from './start/server'
import { createSidePanel } from './start/side-panel'
import { signIn } from './start/sign-in'

declare const __ORIEL_VERSION__: string

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

    const appearance = createAppearance(localStorage)
    const screens = createScreens(book)
    const overlay = debugRequested(location.search) ? new DebugOverlay(document.body) : null
    show('loading', 'Loading the book…')
    // The step an error ends, for the failure page.
    let stage = 'downloaded'
    try {
        const authorization = authorizationHeader(session, deviceId(localStorage), __ORIEL_VERSION__)
        const basePath = serverBasePath(location.pathname)
        const server: ReaderServer = { basePath, authorization, userId: session.userId, itemId }
        const started = performance.now()
        // The theme and font chosen on any device, asked for beside the book;
        // until they arrive the page shows this device's.
        const chosen = chosenOn(server, appearance.settings())
        const fetched = await fetchBook(server)
        const { file } = fetched
        if (await drmProtected(file)) throw new DrmError()

        // What the admin has set for every reader: the translation address and whether readers may add fonts.
        const readerSettings = readReaderSettings(basePath, authorization)
        // The reader's own fonts, declared like the bundled ones, and own
        // themes, applied, before the first page shows.
        const fonts = ownFontsOn(server)
        const themes = ownThemesOn(server)
        const [fontsRead, , kept, admin] = await Promise.all([fonts.ready, themes.ready, chosen.ready, readerSettings])
        appearance.use({ fonts, themes, chosen, fontsRead, kept })
        const downloaded = performance.now()
        overlay?.set('download', `download ${Math.round(downloaded - started)} ms · ${(file.size / 1048576).toFixed(1)} MB`)
        stage = 'opened'
        let controls: Controls | null = null
        let text: TextMarks | null = null
        // The reading gestures hint follows the reader's last input, in this page and in the book's own documents.
        const input = lastInput(() => matchMedia('(pointer: coarse)').matches)
        input.watch(window)
        const sections = createSections(input)
        const margins = (): Margins => screens.margins(appearance.settings())
        // A tap in the middle of the page shows the controls; a page turn
        // hides them and closes the Selected text toolbar.
        const opened = await openBook(book, file, view => { sections.watch(view); overlay?.timeTurns(view) }, chooseStart(fetched.stored, fetched.jellyfin),
            () => controls?.middle(), () => { controls?.turned(); text?.highlighting.close() },
            appearance.styles(), margins(), appearance.settings().pageTurn, screens.sideways.matches)
        const missing = await placeMissing(opened, fetched)
        overlay?.set('open', `first page ${Math.round(performance.now() - downloaded)} ms after download`)
        show('rendered')

        const pages = createPageCount({
            book: opened,
            pages: () => appearance.settings().progress === 'pages',
            beside: () => side.beside(),
            marked: () => marked(),
            read: layout => readCount(localStorage, itemId, layout),
            write: (layout, count) => writeCount(localStorage, itemId, layout, count),
            changed() {
                showPlace()
                controls?.refill()
            },
        })
        text = createTextMarks(opened, server, {
            pageOf: cfi => pages.pageOf(cfi),
            search: query => controls?.search(query),
            translateUrl: admin?.translateUrl ?? '',
            wide: () => screens.wide.matches,
            touch: input.touch,
        })
        sections.add(text ? [text.highlighting, text.dictionary] : [])
        const bookmarks = createBookBookmarks(opened, server, cfi => pages.pageOf(cfi))
        const highlights = text?.highlights ?? null
        const marked = (): string[] => [...bookmarks.places(), ...(highlights?.all().map(highlight => highlight.cfi) ?? [])]

        const side = createSidePanel({
            desk: screens.desk,
            setPanel: width => opened.setPanel(width),
            // The bookmarks and highlights on the page shown are placed first, in the layout without the panel.
            opening: () => { for (const cfi of marked()) pages.pageOf(cfi) },
            relaid() {
                pages.recount()
                showPlace()
            },
        })
        const showPlace = createPlaceShown({
            place: () => opened.place(),
            progress: () => appearance.settings().progress,
            count: () => pages.count(),
            beside: () => side.beside(),
            locate: (chapter, fraction, progress, left) => controls?.locate(chapter, fraction, progress, left),
        })
        // The reader's controls: a tap in the middle of the page shows them
        // and a page turn hides them; a move with their slider, or a turn
        // with their arrows on a desktop, keeps them.
        controls = createControls(document.body, {
            title: opened.title,
            detailsUrl: `${basePath}/web/#/details?id=${encodeURIComponent(itemId)}`,
            dataUrl: `${basePath}/Oriel/data.html?id=${encodeURIComponent(itemId)}`,
            licensesUrl: `${basePath}/Oriel/licenses.html?id=${encodeURIComponent(itemId)}`,
            seek: fraction => opened.seek(fraction),
            contents: () => {
                const counted = appearance.settings().progress === 'pages' ? pages.count() : null
                return contentsRows(opened.contents, href => opened.fractionOf(href), opened.place().href,
                    counted && (href => counted.entries[href] ?? null))
            },
            choose: href => opened.goTo(href),
            search: opened.searchable
                ? { run: query => opened.search(query), clear: () => opened.clearSearch(), go: cfi => opened.goTo(cfi) }
                : null,
            bookmarks,
            highlights,
            highlighters: text?.highlighters ?? null,
            highlighterSheet: text?.highlighterSheet ?? null,
            fonts,
            fontUploads: admin?.fontUploads === true,
            themes,
            settings: appearance.settings(),
            fixedLayout: opened.fixedLayout,
            wide: () => screens.wide.matches,
            touch: input.touch,
            storage: localStorage,
            change(changed) {
                if (appearance.change(changed)) opened.setStyles(appearance.styles())
                opened.setMargins(margins())
                opened.setPageTurn(changed.pageTurn)
                pages.recount()
            },
            turnPage: direction => opened.turnPage(direction),
            edges: () => opened.edges(),
            panel: open => side.show(open),
        })
        const turnedOver = (): void => {
            opened.setOneColumn(screens.sideways.matches)
            opened.setMargins(margins())
        }
        screens.wide.addEventListener('change', turnedOver)
        screens.sideways.addEventListener('change', turnedOver)
        fonts.onChange(() => {
            appearance.declareFonts()
            opened.setStyles(appearance.styles())
            pages.recount()
        })
        // A theme edited or deleted recolours the reader at once.
        themes.onChange(() => {
            appearance.theme()
            opened.setStyles(appearance.styles())
        })
        opened.onPlace(showPlace)
        bookmarks.onChange(pages.placeMarked)
        highlights?.onChange(pages.placeMarked)
        pages.recount()
        let resized = 0
        window.addEventListener('resize', () => {
            clearTimeout(resized)
            resized = window.setTimeout(() => pages.recount(), 500)
        })
        savePlaces(opened, server, fetched.storeUnavailable, missing)
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

void start()
