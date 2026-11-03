// Checks what the reader says when reading goes wrong, in the browser named by
// ORIEL_BROWSER: webkit at iPhone size with touch, or chromium at desktop size
// with a mouse. The server is stood in for where it must fail: while it cannot
// be reached (its answers aborted) the failure page says so with Try again, and
// the book opens at its saved place once it answers, on its own and on Try
// again; a DRM-protected EPUB served in the test book's place, and a book the
// server does not have, get their pages without Try again; a save answered
// with 500 brings the not-saved notice, gone once a later save goes through;
// and a session logged out while reading brings the signed-out notice, whose
// Sign in reaches jellyfin-web's sign-in with the return to the book.
// Configured by environment: ORIEL_BASE (server URL including any BaseUrl),
// ORIEL_SERVER_ID, ORIEL_USER_ID, ORIEL_TOKEN, ORIEL_ITEM_ID (the test EPUB),
// ORIEL_USER and ORIEL_PASSWORD (to sign in a session of its own to log out),
// ORIEL_SAVED_TEXT (the first line of the chapter at 0.6 of the book) and
// ORIEL_BROWSER. Exits non-zero on the first failed check.
import { chromium, devices, webkit } from 'playwright'
import { press } from './press.mjs'
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
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
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
const waitFor = async (check, ms, what) => {
    const until = Date.now() + ms
    for (;;) {
        const value = await check()
        if (value) return value
        if (Date.now() > until) fail(`${what} within ${ms / 1000} s`)
        await pause(250)
    }
}

const OFFLINE_TITLE = 'Oriel can’t reach your Jellyfin server.'
const OFFLINE_BODY = 'Check your connection. The book opens as soon as the server answers.'
const NOT_SAVED = 'Your place could not be saved. Oriel will try again when you turn the page.'
const SIGNED_OUT = 'You are signed out of Jellyfin, so your place is not being saved.'
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
    await pause(1000)
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
    await pause(1500)
    await context.route(`**/Oriel/Positions/${itemId}`, route => route.request().method() === 'PUT'
        ? route.fulfill({ status: 500, body: '' }) : route.continue())
    await press(page, 0.9, setup.touch)
    await waitFor(() => noticeWith(page, NOT_SAVED), 10_000, 'the not-saved notice did not show')
    await context.unroute(`**/Oriel/Positions/${itemId}`)
    await press(page, 0.9, setup.touch)
    await waitFor(async () => !await noticeWith(page, NOT_SAVED), 10_000, 'the not-saved notice did not go once a save went through')
    pass(`a save answered with 500 shows '${NOT_SAVED}', and it goes once the next page turn is saved`)
    await context.close()

    // Signed out while reading: the signed-out notice, and Sign in back to the book.
    const signedIn = await call('/Users/AuthenticateByName', { method: 'POST', body: JSON.stringify({ Username: user, Pw: password }) }, header('oriel-e2e-failures-signed-out'))
    const ownToken = signedIn.AccessToken
    ;({ context, page } = await newPage(browser, ownToken))
    await page.goto(`${base}/Oriel/?id=${itemId}`)
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 }).catch(() => fail('the reader did not render the book'))
    await pause(1500)
    await call('/Sessions/Logout', { method: 'POST' }, header('oriel-e2e-failures-signed-out', ownToken))
    await press(page, 0.9, setup.touch)
    const notice = await waitFor(() => noticeWith(page, SIGNED_OUT), 10_000, 'the signed-out notice did not show')
    if (notice.button !== 'Sign in') fail(`the signed-out notice offers ${notice.button}`)
    await press(page, 0.9, setup.touch)
    await pause(6500)
    if (!await noticeWith(page, SIGNED_OUT)) fail('the signed-out notice went away while still signed out')
    await use(page.locator('.notice').getByRole('button', { name: 'Sign in' }))
    await page.waitForURL(/\/web\/(index\.html)?#\/login/, { timeout: 10_000 }).catch(() => fail(`Sign in went to ${page.url()}`))
    const marker = await page.evaluate(() => localStorage.getItem('oriel_return'))
    if (!marker?.includes(itemId)) fail(`Sign in left the return marker ${marker}`)
    pass(`a session logged out while reading shows '${SIGNED_OUT}' with Sign in, which stays, and Sign in opens jellyfin-web's sign-in with the return to the book`)
    await context.close()
} catch (error) {
    console.error(`FAIL: ${browserName}: ${error.message}`)
    failed = true
} finally {
    await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 10_000))])
}
process.exit(failed ? 1 : 0)
