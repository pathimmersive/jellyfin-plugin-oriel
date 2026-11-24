// Checks what the reader says when reading goes wrong, in the browser named by
// ORIEL_BROWSER: webkit at iPhone size with touch, or chromium at desktop size
// with a mouse. The server is stood in for where it must fail: while it cannot
// be reached (its answers aborted) the failure page says so with Try again, and
// the book opens at its saved place once it answers, on its own and on Try
// again; a DRM-protected EPUB served in the test book's place, and a book the
// server does not have, get their pages without Try again; a save answered
// with 500 brings the not-saved notice, gone once a later save goes through;
// while Oriel's store answers 503 storeUnavailable the book opens at Jellyfin's
// place, saves nothing on a page turn, and says the reading data is unavailable;
// and a session logged out while reading brings the signed-out notice, whose
// Sign in reaches jellyfin-web's sign-in with the return to the book. A 401 to
// any read brings the same notice, and the theme chosen is not sent again. A
// highlight, a note and a bookmark the server refuses say so, with the toolbar
// or the Note sheet left as it was. An error once the book is on screen leaves
// it open and its place saved. A download that stalls (through a server of the
// check's own, between the browser and Jellyfin) shows the offline page after
// 30 seconds and drops the request, and a slower one that keeps sending opens.
// Configured by environment: ORIEL_BASE (server URL including any BaseUrl),
// ORIEL_SERVER_ID, ORIEL_USER_ID, ORIEL_TOKEN, ORIEL_ITEM_ID (the test EPUB),
// ORIEL_USER and ORIEL_PASSWORD (to sign in a session of its own to log out),
// ORIEL_SAVED_TEXT (the first line of the chapter at 0.6 of the book) and
// ORIEL_BROWSER. Exits non-zero on the first failed check.
import { createServer, request as ask } from 'node:http'
import { chromium, devices, webkit } from 'playwright'
import { press, pressPoint } from './press.mjs'
import { pause, until, watchMove } from './wait.mjs'
import { zip } from './zip.mjs'

const env = name => {
    const value = process.env[name]
    if (!value) {
        console.error(`FAIL: ${name} is not set`)
        process.exit(2)
    }
    return value
}

const base = env('ORIEL_BASE')
const origin = new URL(base).origin
const token = env('ORIEL_TOKEN')
const serverId = env('ORIEL_SERVER_ID')
const userId = env('ORIEL_USER_ID')
const itemId = env('ORIEL_ITEM_ID')
const user = env('ORIEL_USER')
const password = env('ORIEL_PASSWORD')
const savedText = env('ORIEL_SAVED_TEXT')
const browserName = env('ORIEL_BROWSER')
const setups = {
    webkit: { engine: webkit, context: { ...devices['iPhone 13'] }, touch: true },
    chromium: { engine: chromium, context: { viewport: { width: 1280, height: 800 } }, touch: false },
}
const setup = setups[browserName]
if (!setup) {
    console.error(`FAIL: ORIEL_BROWSER is '${browserName}', expected webkit or chromium`)
    process.exit(2)
}

const fail = message => { throw new Error(message) }
const pass = message => console.log(`PASS: ${browserName}: ${message}`)
const use = locator => setup.touch ? locator.tap() : locator.click()

const header = (deviceId, accessToken) => `MediaBrowser Client="oriel-e2e", Device="e2e", DeviceId="${deviceId}", Version="1.0.0"${accessToken ? `, Token="${accessToken}"` : ''}`
const authorization = header('oriel-e2e-failures', token)
const call = async (path, init = {}, auth = authorization) => {
    const response = await fetch(`${base}${path}`, { ...init, headers: { Authorization: auth, 'Content-Type': 'application/json', ...init.headers } })
    if (!response.ok) fail(`${init.method ?? 'GET'} ${path} returned ${response.status}`)
    return response.status === 204 ? null : response.json()
}
// Saves the place at 0.6 of the book in Jellyfin, newer than any place Oriel kept.
const saveAtSixTenths = () => call(`/UserItems/${itemId}/UserData?userId=${userId}`, {
    method: 'POST', body: JSON.stringify({ PlaybackPositionTicks: 6000000, LastPlayedDate: new Date().toISOString() }),
})

const credentials = accessToken => JSON.stringify({
    Servers: [{ Id: serverId, AccessToken: accessToken, UserId: userId, ManualAddress: origin, DateLastAccessed: Date.now() }],
})
const newPage = async (browser, accessToken = token) => {
    const context = await browser.newContext(setup.context)
    await context.addInitScript(value => {
        localStorage.setItem('jellyfin_credentials', value)
        localStorage.setItem('oriel-hints', JSON.stringify({ first: true, scroll: true }))
    }, credentials(accessToken))
    return { context, page: await context.newPage() }
}

// What the failure page shows, or null when there is none.
const failurePage = page => page.evaluate(() => {
    const element = document.getElementById('failure')
    if (!element) return null
    return {
        kind: element.dataset.kind,
        title: element.querySelector('#status')?.textContent ?? '',
        body: element.querySelector('.body')?.textContent ?? '',
        buttons: [...element.querySelectorAll('.buttons button, .buttons a')].map(each => each.textContent),
        back: element.querySelector('a.back')?.getAttribute('href') ?? '',
        state: document.body.dataset.state,
    }
})
const waitForFailure = async (page, kind) => {
    await page.waitForSelector(`#failure[data-kind="${kind}"]`, { timeout: 30_000 })
        .catch(async () => fail(`no ${kind} failure page; the page is in state ${await page.evaluate(() => document.body.dataset.state)}`))
    return failurePage(page)
}
const sectionText = page => page.evaluate(() =>
    document.querySelector('foliate-view')?.renderer.getContents().map(({ doc }) => doc.body.textContent).join(' ') ?? '')
// The notice at the bottom of the page with this text, or null.
const noticeWith = (page, text) => page.evaluate(text => {
    const notice = [...document.querySelectorAll('.notice')].find(each => each.querySelector('span')?.textContent === text)
    return notice ? { button: notice.querySelector('button')?.textContent ?? null } : null
}, text)
const waitFor = (check, ms, what) => until(check, `${what} within ${ms / 1000} s`, ms)
// Once the book shows where it is, a turn of the page by a tap near its right edge, and the move finished.
const turnPage = async (page, what) => {
    await waitFor(async () => (await page.locator('#reading-footer .progress').innerText()).trim(), 10_000, `the reader showed no progress before ${what}`)
    const moved = await watchMove(page, `${what} did not turn the page`)
    if (!await press(page, 0.9, setup.touch)) fail(`no frame shows the page to tap for ${what}`)
    await moved()
}

const OFFLINE_TITLE = 'Oriel can’t reach your Jellyfin server.'
const OFFLINE_BODY = 'Check your connection. The book opens as soon as the server answers.'
const NOT_SAVED = 'Your place could not be saved. Oriel will try again when you turn the page.'
const SIGNED_OUT = 'You are signed out of Jellyfin, so your place is not being saved.'
const UNAVAILABLE = 'Your reading data is unavailable on this server, so your place and notes will not be saved.'
const HIGHLIGHT_NOT_SAVED = 'Your highlight could not be saved. Try again.'
const HIGHLIGHT_NOT_REMOVED = 'Your highlight could not be removed. Try again.'
const BOOKMARK_NOT_SAVED = 'Your bookmark could not be saved. Try again.'
const BOOKMARK_NOT_REMOVED = 'Your bookmark could not be removed. Try again.'
// Words of the third chapter, which the book opens at.
const WORDS = savedText.split(' ').slice(0, 3).join(' ')
const STORE_ENDPOINTS = /\/Oriel\/(Positions|Bookmarks|Highlights|Highlighters|Themes|Fonts|Choices)(\/|\?|$)/
// The book and its saved places, which the reader asks for while it opens.
const UNREACHABLE = [`**/Items/${itemId}/Download`, `**/Oriel/Positions/${itemId}`, `**/UserItems/${itemId}/UserData*`]

// A book an online store protected: its chapter listed as encrypted with AES.
const drmBook = zip([
    ['mimetype', 'application/epub+zip'],
    ['META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'],
    ['META-INF/encryption.xml', '<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/><enc:CipherData><enc:CipherReference URI="OEBPS/ch1.xhtml"/></enc:CipherData></enc:EncryptedData></encryption>'],
    ['OEBPS/content.opf', '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">oriel-drm</dc:identifier><dc:title>Protected</dc:title><dc:language>en</dc:language></metadata><manifest><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="ch1"/></spine></package>'],
    ['OEBPS/ch1.xhtml', '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title></head><body><p>Protected text.</p></body></html>'],
])

// Selects `words` in the section shown, as a long press and a handle drag leave it.
const select = (page, words) => page.evaluate(words => {
    const { doc } = document.querySelector('foliate-view').renderer.getContents()[0]
    const text = [...doc.querySelectorAll('p')].map(p => p.firstChild).find(node => node?.textContent.includes(words))
    const at = text.textContent.indexOf(words)
    const range = doc.createRange()
    range.setStart(text, at)
    range.setEnd(text, at + words.length)
    doc.getSelection().removeAllRanges()
    doc.getSelection().addRange(range)
}, words)
const highlightsStored = async () => (await call(`/Oriel/Highlights/${itemId}`)).filter(each => each.text === WORDS)
const open = async (page, at = base) => {
    await page.goto(`${at}/Oriel/?id=${itemId}`)
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 }).catch(() => fail('the reader did not render the book'))
}

// A server between the browser and Jellyfin that passes everything through but
// the book's download, whose bytes it sends as `send` does.
const between = async send => {
    const server = createServer((request, response) => {
        const upstream = ask(new URL(request.url, origin), { method: request.method, headers: { ...request.headers, host: new URL(origin).host, 'accept-encoding': 'identity' } }, async answer => {
            response.writeHead(answer.statusCode, answer.headers)
            if (!request.url.includes('/Download')) return answer.pipe(response)
            const chunks = []
            for await (const chunk of answer) chunks.push(chunk)
            await send(Buffer.concat(chunks), response)
        })
        upstream.on('error', () => response.destroy())
        request.pipe(upstream)
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const at = `http://127.0.0.1:${server.address().port}`
    return { at, origin: at + new URL(base).pathname.replace(/\/$/, ''), close: () => { server.closeAllConnections(); server.close() } }
}
const pageThrough = async (browser, server) => {
    const context = await browser.newContext(setup.context)
    await context.addInitScript(value => {
        localStorage.setItem('jellyfin_credentials', value)
        localStorage.setItem('oriel-hints', JSON.stringify({ first: true, scroll: true }))
    }, JSON.stringify({ Servers: [{ Id: serverId, AccessToken: token, UserId: userId, ManualAddress: server.at, DateLastAccessed: Date.now() }] }))
    return { context, page: await context.newPage() }
}

const browser = await setup.engine.launch()
let failed = false
try {
    // The server cannot be reached; once it answers, the book opens on its own, at its saved place.
    await saveAtSixTenths()
    let { context, page } = await newPage(browser)
    for (const pattern of UNREACHABLE) await context.route(pattern, route => route.abort('internetdisconnected'))
    await page.goto(`${base}/Oriel/?id=${itemId}`)
    let shown = await waitForFailure(page, 'offline')
    if (shown.title !== OFFLINE_TITLE || shown.body !== OFFLINE_BODY || shown.state !== 'error') fail(`the offline page shows ${JSON.stringify(shown)}`)
    if (shown.buttons.join('|') !== 'Try again|Back to Jellyfin' || !shown.back.endsWith('/web/#/home')) fail(`the offline page offers ${shown.buttons.join(', ')}, back to ${shown.back}`)
    pass(`a server that cannot be reached shows '${OFFLINE_TITLE}' with Try again and Back to Jellyfin`)
    // Longer than the reader's 5 seconds between asks: the page must stay while the server still cannot be reached.
    await pause(6000)
    if (!await page.locator('#failure').isVisible()) fail('the offline page went away while the server still could not be reached')
    for (const pattern of UNREACHABLE) await context.unroute(pattern)
    const answered = Date.now()
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 12_000 }).catch(() => fail('the book did not open on its own once the server answered'))
    if (await page.locator('#failure').count()) fail('the failure page stayed over the book')
    if (!(await sectionText(page)).includes(savedText)) fail(`the book opened, but not at its saved place ('${savedText}')`)
    pass(`once the server answers the book opens on its own, ${Math.round((Date.now() - answered) / 1000)} s later, at its saved place`)
    await context.close()

    // The same, with Try again: it opens at once, not at the next 5-second retry.
    ;({ context, page } = await newPage(browser))
    for (const pattern of UNREACHABLE) await context.route(pattern, route => route.abort('internetdisconnected'))
    await page.goto(`${base}/Oriel/?id=${itemId}`)
    await waitForFailure(page, 'offline')
    for (const pattern of UNREACHABLE) await context.unroute(pattern)
    const pressed = Date.now()
    await use(page.getByRole('button', { name: 'Try again' }))
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 10_000 }).catch(() => fail('Try again did not open the book'))
    const took = Date.now() - pressed
    if (took > 3500) fail(`Try again took ${took} ms to open the book, as if it waited for the next retry`)
    pass(`Try again opens the book at once (${took} ms)`)
    await context.close()

    // A DRM-protected book: its page, without Try again.
    ;({ context, page } = await newPage(browser))
    await context.route(`**/Items/${itemId}/Download`, route => route.fulfill({
        status: 200, contentType: 'application/epub+zip', body: drmBook,
        headers: { 'Content-Disposition': 'attachment; filename="protected.epub"' },
    }))
    await page.goto(`${base}/Oriel/?id=${itemId}`)
    shown = await waitForFailure(page, 'drm')
    if (shown.title !== 'This book can’t be opened.' || shown.body !== 'It is protected with DRM, so only the app or store it came from can open it.') fail(`the DRM page shows ${JSON.stringify(shown)}`)
    if (shown.buttons.join('|') !== 'Back to Jellyfin') fail(`the DRM page offers ${shown.buttons.join(', ')}`)
    pass('a DRM-protected EPUB shows \'This book can’t be opened.\' and why, without Try again')
    await context.close()

    // A book the server does not have.
    ;({ context, page } = await newPage(browser))
    await page.goto(`${base}/Oriel/?id=00000000000040008000000000000000`)
    shown = await waitForFailure(page, 'notFound')
    if (shown.title !== 'This book was not found in your Jellyfin library.' || shown.body !== 'It may have been removed, or your account may not have access to it.' || shown.buttons.join('|') !== 'Back to Jellyfin') fail(`the not-found page shows ${JSON.stringify(shown)}`)
    pass('a book the server does not have shows \'This book was not found in your Jellyfin library.\' and why, without Try again')
    await context.close()

    // A save the server refuses: the not-saved notice, gone once a save goes through.
    ;({ context, page } = await newPage(browser))
    await page.goto(`${base}/Oriel/?id=${itemId}`)
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 }).catch(() => fail('the reader did not render the book'))
    await context.route(`**/Oriel/Positions/${itemId}`, route => route.request().method() === 'PUT'
        ? route.fulfill({ status: 500, body: '' }) : route.continue())
    // The place Oriel cannot keep goes to Jellyfin, stamped with the time now.
    const toJellyfin = page.waitForRequest(request => request.method() === 'POST' && request.url().includes(`/UserItems/${itemId}/UserData`), { timeout: 15_000 })
        .catch(() => fail('a place Oriel could not save was not written to Jellyfin'))
    const refusedAt = Date.now()
    await turnPage(page, 'the turn whose save is refused')
    const { PlaybackPositionTicks: kept503, LastPlayedDate: stamped } = JSON.parse((await toJellyfin).postData())
    if (!(kept503 > 0) || Date.parse(stamped) < refusedAt) fail(`the place Oriel could not save went to Jellyfin as ${kept503} at ${stamped}`)
    await waitFor(() => noticeWith(page, NOT_SAVED), 10_000, 'the not-saved notice did not show')
    await context.unroute(`**/Oriel/Positions/${itemId}`)
    await turnPage(page, 'the turn whose save goes through')
    await waitFor(async () => !await noticeWith(page, NOT_SAVED), 10_000, 'the not-saved notice did not go once a save went through')
    pass(`a save answered with 500 shows '${NOT_SAVED}', and it goes once the next page turn is saved`)
    await context.close()

    // Oriel's store cannot be opened on the server: Jellyfin's place, nothing saved, and the notice.
    await saveAtSixTenths()
    ;({ context, page } = await newPage(browser))
    const saves = []
    await context.route(STORE_ENDPOINTS, route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"reason":"storeUnavailable"}' }))
    page.on('request', request => {
        if (request.method() !== 'GET' && (STORE_ENDPOINTS.test(request.url()) || request.url().includes('/UserData'))) saves.push(`${request.method()} ${request.url()}`)
    })
    await page.goto(`${base}/Oriel/?id=${itemId}`)
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 }).catch(() => fail('the reader did not render the book while the store is unavailable'))
    await waitFor(() => noticeWith(page, UNAVAILABLE), 10_000, 'the unavailable notice did not show')
    if (!(await sectionText(page)).includes(savedText)) fail(`with the store unavailable the book did not open at Jellyfin's place ('${savedText}')`)
    await turnPage(page, 'a turn with the store unavailable')
    // Longer than the reader waits before saving a move: nothing must be saved.
    await pause(6000)
    if (saves.length) fail(`with the store unavailable the reader saved: ${saves.join(', ')}`)
    if (!await noticeWith(page, UNAVAILABLE)) fail('the unavailable notice went away after a page turn')
    pass(`with the store answering 503 the book opens at Jellyfin's place, a page turn saves nothing, and it says '${UNAVAILABLE}'`)
    await context.close()

    // Signed out while reading: the signed-out notice, and Sign in back to the book.
    const signedIn = await call('/Users/AuthenticateByName', { method: 'POST', body: JSON.stringify({ Username: user, Pw: password }) }, header('oriel-e2e-failures-signed-out'))
    const ownToken = signedIn.AccessToken
    ;({ context, page } = await newPage(browser, ownToken))
    await page.goto(`${base}/Oriel/?id=${itemId}`)
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 }).catch(() => fail('the reader did not render the book'))
    await call('/Sessions/Logout', { method: 'POST' }, header('oriel-e2e-failures-signed-out', ownToken))
    await turnPage(page, 'the first turn signed out')
    const notice = await waitFor(() => noticeWith(page, SIGNED_OUT), 10_000, 'the signed-out notice did not show')
    if (notice.button !== 'Sign in') fail(`the signed-out notice offers ${notice.button}`)
    // The next save is refused too; the notice must still be there once it has been answered.
    const refusedAgain = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().includes(`/Oriel/Positions/${itemId}`), { timeout: 15_000 })
        .catch(() => fail('the turn after the signed-out notice was not saved, so the notice was never tested against a second refusal'))
    await turnPage(page, 'the second turn signed out')
    const answer = await refusedAgain
    if (answer.status() !== 401) fail(`signed out, a save was answered with ${answer.status()}`)
    if (!await noticeWith(page, SIGNED_OUT)) fail('the signed-out notice went away while still signed out')
    await use(page.locator('.notice').getByRole('button', { name: 'Sign in' }))
    await page.waitForURL(/\/web\/(index\.html)?#\/login/, { timeout: 10_000 }).catch(() => fail(`Sign in went to ${page.url()}`))
    const marker = await page.evaluate(() => localStorage.getItem('oriel_return'))
    if (!marker?.includes(itemId)) fail(`Sign in left the return marker ${marker}`)
    pass(`a session logged out while reading shows '${SIGNED_OUT}' with Sign in, which stays, and Sign in opens jellyfin-web's sign-in with the return to the book`)
    await context.close()

    // A 401 to any read, each on its own: the book opens, and says the session has ended.
    const reads = [`/Oriel/Highlights/${itemId}`, `/Oriel/Bookmarks/${itemId}`, '/Oriel/Highlighters', '/Oriel/Themes', '/Oriel/Fonts', '/Oriel/Choices', '/Oriel/ReaderSettings', `/Oriel/Positions/${itemId}`]
    for (const read of reads) {
        ;({ context, page } = await newPage(browser))
        await context.route(`**${read}`, route => route.request().method() === 'GET' ? route.fulfill({ status: 401, body: '' }) : route.continue())
        await open(page)
        const said = await waitFor(() => noticeWith(page, SIGNED_OUT), 10_000, `a 401 to ${read} did not bring the signed-out notice`)
        if (said.button !== 'Sign in') fail(`the signed-out notice after a 401 to ${read} offers ${said.button}`)
        await context.close()
    }
    pass(`a 401 to any read (${reads.length} of them, one at a time) shows '${SIGNED_OUT}' with Sign in over the open book`)

    // The theme chosen is sent once, and not again, once the session has ended.
    ;({ context, page } = await newPage(browser))
    const choicesBefore = await call('/Oriel/Choices')
    const choicesSent = []
    await context.route('**/Oriel/Choices', route => {
        if (route.request().method() !== 'PUT') return route.continue()
        choicesSent.push(route.request().postData())
        return route.fulfill({ status: 401, body: '' })
    })
    await open(page)
    if (!await press(page, 0.5, setup.touch)) fail('no frame shows the page to tap for the controls')
    await use(page.getByRole('button', { name: 'Preferences' }))
    await use(page.locator('#prefs').getByRole('button', { name: 'Sepia', exact: true }))
    await waitFor(() => noticeWith(page, SIGNED_OUT), 10_000, 'a 401 to the theme chosen did not bring the signed-out notice')
    await use(page.locator('#prefs').getByRole('button', { name: 'Dark', exact: true }))
    // Longer than the first three waits between the sends of a choice the server has not taken (2, 4 and 8 seconds).
    await pause(15_000)
    if (choicesSent.length !== 1) fail(`signed out, the theme was sent ${choicesSent.length} times`)
    await context.unroute('**/Oriel/Choices')
    const sentNext = page.waitForRequest(request => request.method() === 'PUT' && request.url().includes('/Oriel/Choices'), { timeout: 20_000 })
        .catch(() => fail('the theme chosen while signed out was not sent on the next open'))
    await open(page)
    if (JSON.parse((await sentNext).postData()).theme !== 'dark') fail(`the next open sent ${(await sentNext).postData()}`)
    await context.close()
    // As it was, for the checks after this one.
    await call('/Oriel/Choices', { method: 'PUT', body: JSON.stringify({ theme: choicesBefore.theme ?? 'light', font: choicesBefore.font ?? 'Default' }) })
    pass('a theme refused with 401 is sent once, not again, and the latest choice is sent on the next open')

    // A highlight the server refuses: the notice, and the toolbar and the selection left as they were.
    await saveAtSixTenths()
    ;({ context, page } = await newPage(browser))
    const highlightsAt = new RegExp(`/Oriel/Highlights/${itemId}(/|$)`)
    let refuse = true
    await context.route(highlightsAt, route => refuse && route.request().method() !== 'GET' ? route.fulfill({ status: 500, body: '' }) : route.continue())
    await open(page)
    const toolbar = page.getByRole('toolbar', { name: 'Selected text' })
    const sheet = page.getByRole('region', { name: 'Note' })
    await select(page, WORDS)
    await waitFor(() => toolbar.isVisible(), 5000, 'selecting text did not show the toolbar')
    await use(toolbar.getByRole('button', { name: 'Highlight: Green' }))
    await waitFor(() => noticeWith(page, HIGHLIGHT_NOT_SAVED), 10_000, 'a highlight refused with 500 said nothing')
    if (!await toolbar.isVisible()) fail('the toolbar closed on a highlight that was not saved')
    if ((await page.evaluate(() => document.querySelector('foliate-view').renderer.getContents()[0].doc.getSelection().toString())) !== WORDS) fail('the selection was let go for a highlight that was not saved')
    pass(`a highlight refused with 500 shows '${HIGHLIGHT_NOT_SAVED}' and leaves the toolbar and the selection`)

    // The same from the Note sheet: what was typed stays, nothing covers Save, and Save keeps it once the server takes it.
    await use(toolbar.getByRole('button', { name: 'Note', exact: true }))
    await sheet.getByRole('textbox', { name: 'Note' }).fill('Not to be lost.')
    await waitFor(async () => !await noticeWith(page, HIGHLIGHT_NOT_SAVED), 12_000, 'the notice of a highlight not saved did not go by itself')
    await use(sheet.getByRole('button', { name: 'Save' }))
    await waitFor(() => noticeWith(page, HIGHLIGHT_NOT_SAVED), 10_000, 'a note refused with 500 said nothing')
    if (!await sheet.isVisible() || await sheet.getByRole('textbox', { name: 'Note' }).inputValue() !== 'Not to be lost.') fail('the Note sheet lost a note that was not saved')
    const covered = await page.evaluate(() => {
        const save = document.querySelector('#note .save').getBoundingClientRect()
        const notice = [...document.querySelectorAll('.notice')].at(-1).getBoundingClientRect()
        const seen = document.elementFromPoint(notice.left + notice.width / 2, notice.top + notice.height / 2)
        return { save: !(notice.bottom < save.top || notice.top > save.bottom || notice.right < save.left || notice.left > save.right), notice: { top: notice.top, bottom: notice.bottom }, under: seen?.id || seen?.className || seen?.tagName }
    })
    if (covered.save) fail(`the notice covers Save: ${JSON.stringify(covered)}`)
    refuse = false
    await use(sheet.getByRole('button', { name: 'Save' }))
    await waitFor(async () => !await sheet.isVisible(), 5000, 'the Note sheet stayed once its note was saved')
    let kept = await waitFor(async () => { const all = await highlightsStored(); return all.length && all }, 5000, 'the note saved at last is not on the server')
    if (kept.length !== 1 || kept[0].note !== 'Not to be lost.') fail(`the server keeps ${JSON.stringify(kept)}`)
    pass('a note that could not be saved stays on its sheet, clear of the notice, and Save keeps it once the server takes it')

    // Recoloured and removed, each refused: the notice, and the highlight as it was.
    const tapHighlight = async () => {
        const at = await page.evaluate(words => {
            const { doc } = document.querySelector('foliate-view').renderer.getContents()[0]
            const frame = doc.defaultView.frameElement.getBoundingClientRect()
            const text = [...doc.querySelectorAll('p')].map(p => p.firstChild).find(node => node?.textContent.includes(words))
            const range = doc.createRange()
            range.setStart(text, text.textContent.indexOf(words))
            range.setEnd(text, text.textContent.indexOf(words) + words.length)
            const [line] = range.getClientRects()
            return { x: frame.left + (line.left + line.right) / 2, y: frame.top + (line.top + line.bottom) / 2 }
        }, WORDS)
        if (!await pressPoint(page, at.x, at.y, setup.touch)) fail('no frame shows the page to tap')
        await waitFor(() => toolbar.isVisible(), 5000, 'tapping the highlight did not show the toolbar')
    }
    refuse = true
    await tapHighlight()
    await use(toolbar.getByRole('button', { name: 'Highlight: Pink' }))
    await waitFor(() => noticeWith(page, HIGHLIGHT_NOT_SAVED), 10_000, 'a colour refused with 500 said nothing')
    if (!await toolbar.isVisible()) fail('the toolbar closed on a colour that was not saved')
    await use(toolbar.getByRole('button', { name: 'Remove' }))
    await waitFor(() => noticeWith(page, HIGHLIGHT_NOT_REMOVED), 10_000, 'a removal refused with 500 said nothing')
    kept = await highlightsStored()
    if (kept.length !== 1 || kept[0].colour === 'pink') fail(`after refused changes the server keeps ${JSON.stringify(kept)}`)
    await call(`/Oriel/Highlights/${itemId}/${kept[0].id}`, { method: 'DELETE' })
    pass(`a colour refused says '${HIGHLIGHT_NOT_SAVED}' with the toolbar left, and a removal refused '${HIGHLIGHT_NOT_REMOVED}'`)
    await context.close()

    // A bookmark refused, and a removal refused.
    ;({ context, page } = await newPage(browser))
    const bookmarksAt = new RegExp(`/Oriel/Bookmarks/${itemId}(/|$)`)
    let refuseMark = true
    await context.route(bookmarksAt, route => refuseMark && route.request().method() !== 'GET' ? route.fulfill({ status: 500, body: '' }) : route.continue())
    await open(page)
    const mark = page.locator('#reading-footer .bookmark')
    await use(mark)
    await waitFor(() => noticeWith(page, BOOKMARK_NOT_SAVED), 10_000, 'a bookmark refused with 500 said nothing')
    if (await mark.getAttribute('aria-pressed') !== 'false') fail('a bookmark that was not saved shows as one')
    refuseMark = false
    await use(mark)
    await waitFor(async () => await mark.getAttribute('aria-pressed') === 'true', 5000, 'the bookmark was not added once the server takes it')
    refuseMark = true
    await use(mark)
    await waitFor(() => noticeWith(page, BOOKMARK_NOT_REMOVED), 10_000, 'a bookmark whose removal is refused said nothing')
    for (const each of await call(`/Oriel/Bookmarks/${itemId}`)) await call(`/Oriel/Bookmarks/${itemId}/${each.id}`, { method: 'DELETE' })
    pass(`a bookmark refused says '${BOOKMARK_NOT_SAVED}', and one whose removal is refused '${BOOKMARK_NOT_REMOVED}'`)
    await context.close()

    // An error in the rest of the set-up, once the book is on screen: the book stays, and its place is saved.
    await saveAtSixTenths()
    ;({ context, page } = await newPage(browser))
    await context.addInitScript(() => {
        const set = Element.prototype.setAttribute
        Element.prototype.setAttribute = function (name, value) {
            if (value === 'Selected text') {
                window.orielThrown = true
                throw new Error('the check broke the set-up')
            }
            return set.call(this, name, value)
        }
    })
    await open(page)
    await waitFor(() => page.evaluate(() => window.orielThrown), 10_000, 'the set-up did not reach the error planted in it')
    if (await page.locator('#failure').count() || await page.evaluate(() => document.body.dataset.state) !== 'rendered') fail('an error in the set-up replaced a book on screen')
    if (!(await sectionText(page)).includes(savedText)) fail('an error in the set-up took the book off the page')
    const savedAfter = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().includes(`/Oriel/Positions/${itemId}`), { timeout: 15_000 })
        .catch(() => fail('after an error in the set-up a page turn was not saved'))
    const movedOn = await watchMove(page, 'the page did not turn after an error in the set-up')
    if (!await press(page, 0.9, setup.touch)) fail('no frame shows the page to tap after an error in the set-up')
    await movedOn()
    if ((await savedAfter).status() !== 200) fail(`after an error in the set-up the save was answered ${(await savedAfter).status()}`)
    pass('an error in the set-up once the book is on screen leaves it open, and the next page turn is saved')
    await context.close()

    // A download that stalls part way, and at the same time one that sends slowly for longer than the limit.
    let stalled = true
    let dropped = null
    const stalling = await between(async (book, response) => {
        if (!stalled) return response.end(book)
        response.write(book.subarray(0, 64))
        response.on('close', () => { dropped ??= Date.now() })
    })
    const slow = await between(async (book, response) => {
        const quarter = Math.ceil(book.length / 5)
        for (let at = 0; at < book.length; at += quarter) {
            response.write(book.subarray(at, at + quarter))
            // The wait between its parts is the point: 36 seconds in all, none of them 30.
            await pause(9000)
        }
        response.end()
    })
    try {
        const [stall, crawl] = [await pageThrough(browser, stalling), await pageThrough(browser, slow)]
        const since = Date.now()
        await Promise.all([
            (async () => {
                await stall.page.goto(`${stalling.origin}/Oriel/?id=${itemId}`)
                await stall.page.waitForSelector('#failure[data-kind="offline"]', { timeout: 45_000 }).catch(() => fail('a stalled download did not show the offline page within 45 s'))
                const waited = (Date.now() - since) / 1000
                if (waited < 28) fail(`the offline page came after ${waited} s without a byte, not 30`)
                const page = await failurePage(stall.page)
                if (page.title !== OFFLINE_TITLE || page.buttons.join('|') !== 'Try again|Back to Jellyfin') fail(`a stalled download shows ${JSON.stringify(page)}`)
                await waitFor(() => dropped, 5000, 'the stalled request was not dropped')
                stalled = false
                await use(stall.page.getByRole('button', { name: 'Try again' }))
                await stall.page.waitForSelector('body[data-state="rendered"]', { timeout: 15_000 }).catch(() => fail('the book did not open once the server sent it'))
                pass(`a download that stalls shows the offline page after ${Math.round(waited)} s and drops the request, and Try again opens the book`)
            })(),
            (async () => {
                await crawl.page.goto(`${slow.origin}/Oriel/?id=${itemId}`)
                await crawl.page.waitForSelector('body[data-state="rendered"], #failure', { timeout: 90_000 }).catch(() => fail('a slow download did not open'))
                const waited = (Date.now() - since) / 1000
                if (await crawl.page.locator('#failure').count()) fail(`a slow download that keeps sending was stopped after ${waited} s`)
                if (waited < 32) fail(`the slow download took ${waited} s, too short to show anything`)
                pass(`a download that keeps sending for ${Math.round(waited)} s opens`)
            })(),
        ])
        await stall.context.close()
        await crawl.context.close()
    } finally {
        stalling.close()
        slow.close()
    }
} catch (error) {
    console.error(`FAIL: ${browserName}: ${error.message}`)
    failed = true
} finally {
    // WebKit can hang while closing; the result is already known, so stop waiting.
    await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 10_000))])
}
process.exit(failed ? 1 : 0)
