// Drives the reader in Playwright WebKit against a running Jellyfin server.
// Configured by environment: ORIEL_BASE (server URL including any BaseUrl),
// ORIEL_SERVER_ID, ORIEL_USER_ID, ORIEL_TOKEN, ORIEL_ITEM_ID, ORIEL_EXPECT_TEXT,
// ORIEL_MISSING_ID. Exits non-zero on the first failed check.
import { webkit } from 'playwright'

const env = name => {
    const value = process.env[name]
    if (!value) {
        console.error(`FAIL: ${name} is not set`)
        process.exit(2)
    }
    return value
}

const base = env('ORIEL_BASE')
const serverId = env('ORIEL_SERVER_ID')
const userId = env('ORIEL_USER_ID')
const token = env('ORIEL_TOKEN')
const itemId = env('ORIEL_ITEM_ID')
const expectText = env('ORIEL_EXPECT_TEXT')
const missingId = env('ORIEL_MISSING_ID')

// The shape jellyfin-web 12.x stores for a signed-in server.
const credentials = JSON.stringify({
    Servers: [{
        Id: serverId,
        AccessToken: token,
        UserId: userId,
        ManualAddress: new URL(base).origin,
        DateLastAccessed: Date.now(),
    }],
})

const fail = message => { throw new Error(message) }
const pass = message => console.log(`PASS: ${message}`)

const settled = async page => {
    await page.waitForSelector('body[data-state="rendered"], body[data-state="error"]', { timeout: 30_000 })
        .catch(() => fail(`reader at ${page.url()} never reported rendered or error`))
    return page.evaluate(() => ({
        state: document.body.dataset.state,
        message: document.getElementById('status')?.textContent ?? '',
    }))
}

// The book renders in iframes inside a closed shadow root, so read every frame.
const frameText = async page => {
    const texts = await Promise.all(page.frames().map(frame =>
        frame.evaluate(() => document.body?.innerText ?? '').catch(() => '')))
    return texts.join('\n')
}

const browser = await webkit.launch()
try {
    const signedIn = await browser.newContext()
    await signedIn.addInitScript(value => {
        localStorage.setItem('jellyfin_credentials', value)
    }, credentials)
    const page = await signedIn.newPage()

    let downloadAuth = null
    page.on('request', request => {
        if (request.url().includes(`/Items/${itemId}/Download`)) {
            downloadAuth = request.headers()['authorization'] ?? ''
        }
    })

    await page.goto(`${base}/Oriel/?id=${itemId}`)
    const opened = await settled(page)
    if (opened.state !== 'rendered') fail(`reader reported ${opened.state}: ${opened.message}`)
    if (downloadAuth === null) fail('reader never requested /Items/{id}/Download')
    if (!/^MediaBrowser /.test(downloadAuth) || !downloadAuth.includes(`Token="${token}"`)) {
        fail(`Download request carried Authorization '${downloadAuth}'`)
    }
    pass('reader fetched the book through /Items/{id}/Download with the MediaBrowser header')

    const deadline = Date.now() + 15_000
    while (!(await frameText(page)).includes(expectText)) {
        if (Date.now() > deadline) fail(`first-chapter text '${expectText}' was not rendered`)
        await page.waitForTimeout(250)
    }
    pass(`book rendered with first-chapter text at ${base}/Oriel/`)

    if (await page.locator('#debug').count() !== 0) fail('debug overlay shown without ?debug=1')
    await page.goto(`${base}/Oriel/?id=${itemId}&debug=1`)
    const debugged = await settled(page)
    if (debugged.state !== 'rendered') fail(`reader with ?debug=1 reported ${debugged.state}: ${debugged.message}`)
    const overlay = await page.locator('#debug').textContent({ timeout: 5_000 }).catch(() => null)
    if (!overlay || !/download \d+ ms/.test(overlay) || !/first page \d+ ms/.test(overlay)) {
        fail(`debug overlay missing or without timings: '${overlay}'`)
    }
    pass(`?debug=1 shows the overlay: ${overlay.replace(/\s+/g, ' ').trim()}`)

    await page.goto(`${base}/Oriel/?id=${missingId}`)
    const missing = await settled(page)
    if (missing.state !== 'error' || !/not found/i.test(missing.message)) {
        fail(`unknown item reported ${missing.state}: '${missing.message}'`)
    }
    pass(`unknown item shows '${missing.message}'`)

    const signedOut = await browser.newContext()
    const anonymous = await signedOut.newPage()
    await anonymous.goto(`${base}/Oriel/?id=${itemId}`)
    const loginPath = `${new URL(base).pathname.replace(/\/$/, '')}/web/`
    await anonymous.waitForURL(url => url.pathname === loginPath && url.hash.startsWith('#/login'), { timeout: 15_000 })
        .catch(() => fail(`no credentials did not redirect to ${loginPath}#/login (at ${anonymous.url()})`))
    pass(`no credentials redirects to ${loginPath}#/login`)
} catch (error) {
    console.error(`FAIL: ${error.message}`)
    process.exitCode = 1
} finally {
    await browser.close()
}
