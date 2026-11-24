// Checks that a place is never left behind in Jellyfin, in the browser named by
// ORIEL_BROWSER: webkit at iPhone size with touch, or chromium at desktop size.
// Through the API, a place saved in Oriel is written to Jellyfin by the server
// with the same time, and nothing else in the user data changes. In the reader,
// a page turned and the reader left at once (the page closed by going elsewhere,
// or hidden and then gone) sends one request, after which Oriel and Jellyfin both
// hold the new place and Resume lists the book. A place refused by Oriel is
// covered by failures.e2e.mjs. Configured by environment: ORIEL_BASE (server URL
// including any BaseUrl), ORIEL_SERVER_ID, ORIEL_USER_ID, ORIEL_TOKEN,
// ORIEL_ITEM_ID (the test EPUB) and ORIEL_BROWSER. Exits non-zero on the first
// failed check.
import { chromium, devices, webkit } from 'playwright'
import { press } from './press.mjs'
import { pause, until, watchMove } from './wait.mjs'

const env = name => {
    const value = process.env[name]
    if (!value) {
        console.error(`FAIL: ${name} is not set`)
        process.exit(2)
    }
    return value
}

const base = env('ORIEL_BASE')
const userId = env('ORIEL_USER_ID')
const token = env('ORIEL_TOKEN')
const itemId = env('ORIEL_ITEM_ID')
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
const authorization = `MediaBrowser Client="oriel-e2e", Device="e2e", DeviceId="oriel-e2e-leaving", Version="1.0.0", Token="${token}"`
const call = async (path, init = {}) => {
    const response = await fetch(`${base}${path}`, { ...init, headers: { Authorization: authorization, 'Content-Type': 'application/json', ...init.headers } })
    if (!response.ok) fail(`${init.method ?? 'GET'} ${path} returned ${response.status}`)
    const text = await response.text()
    return text ? JSON.parse(text) : null
}
const userData = () => call(`/UserItems/${itemId}/UserData?userId=${userId}`)
const setUserData = body => call(`/UserItems/${itemId}/UserData?userId=${userId}`, { method: 'POST', body: JSON.stringify(body) })
const stored = () => call(`/Oriel/Positions/${itemId}`)
const resumed = async () => (await call(`/UserItems/Resume?userId=${userId}&mediaTypes=Book&limit=50`)).Items.find(item => item.Id === itemId) ?? null
// A time to the 100 ns both servers keep, whatever offset and trailing zeros it is written with.
const exactly = value => {
    const [, seconds, part = ''] = /^(.*?:\d\d)(?:\.(\d+))?(?:Z|\+00:00)$/.exec(value) ?? fail(`'${value}' is not a time in UTC`)
    return `${seconds}.${part.padEnd(7, '0')}`
}

const credentials = JSON.stringify({
    Servers: [{ Id: env('ORIEL_SERVER_ID'), AccessToken: token, UserId: userId, ManualAddress: new URL(base).origin, DateLastAccessed: Date.now() }],
})

const browser = await setup.engine.launch()
let failed = false
try {
    // The server's own write, beside what must not change.
    const before = { Played: false, PlayCount: 3, IsFavorite: true }
    await setUserData({ ...before, PlaybackPositionTicks: 0, LastPlayedDate: new Date(Date.now() - 3_600_000).toISOString() })
    const saved = await call(`/Oriel/Positions/${itemId}`, { method: 'PUT', body: JSON.stringify({ cfi: 'epubcfi(/6/4!/4/2/1:0)', fraction: 0.31234567 }) })
    const written = await userData()
    if (written.PlaybackPositionTicks !== 3_123_457) fail(`a place at 0.31234567 gave Jellyfin ${written.PlaybackPositionTicks} ticks`)
    if (exactly(written.LastPlayedDate) !== exactly(saved.savedAt)) fail(`the place was saved at ${saved.savedAt} and Jellyfin has ${written.LastPlayedDate}`)
    for (const [name, value] of Object.entries(before)) if (written[name] !== value) fail(`saving a place changed ${name} from ${value} to ${written[name]}`)
    if ((await resumed())?.UserData?.PlaybackPositionTicks !== 3_123_457) fail('Resume does not list the book at the place saved')
    pass(`a place saved in Oriel is in Jellyfin with the same time (${saved.savedAt}), with Played, PlayCount and IsFavorite as they were, and Resume lists the book`)

    const leavings = [
        ['closed', page => page.goto('about:blank')],
        ['hidden', async page => {
            await page.evaluate(() => {
                Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
                document.dispatchEvent(new Event('visibilitychange'))
            })
            await page.goto('about:blank')
        }],
    ]
    for (const [how, leave] of leavings) {
        await setUserData({ PlaybackPositionTicks: 0, LastPlayedDate: new Date(Date.now() - 3_600_000).toISOString() })
        const start = await call(`/Oriel/Positions/${itemId}`, { method: 'PUT', body: JSON.stringify({ cfi: 'epubcfi(/6/4!/4/2/1:0)', fraction: 0.25 }) })
        const context = await browser.newContext(setup.context)
        await context.addInitScript(value => {
            localStorage.setItem('jellyfin_credentials', value)
            localStorage.setItem('oriel-hints', JSON.stringify({ first: true, scroll: true }))
            // What the page sends, noted before it goes: Playwright does not see a request that outlives its page in Chromium.
            const send = window.fetch
            window.fetch = (input, init) => {
                if (init?.method && init.method !== 'GET' && /\/Oriel\/Positions\/|\/UserData/.test(String(input))) {
                    localStorage.setItem('oriel-check-sent', `${localStorage.getItem('oriel-check-sent') ?? ''}${init.method} ${new URL(String(input), location.href).pathname}\n`)
                }
                return send.call(window, input, init)
            }
        }, credentials)
        const page = await context.newPage()
        const sentBy = from => from.evaluate(() => (localStorage.getItem('oriel-check-sent') ?? '').split('\n').filter(Boolean))
        await page.goto(`${base}/Oriel/?id=${itemId}`)
        await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 }).catch(() => fail('the reader did not render the book'))
        await until(async () => (await page.locator('#reading-footer .progress').innerText()).trim(), 'the reader showed no progress')
        // The turn itself, not a book still settling where it opened.
        const at = () => page.evaluate(() => document.querySelector('foliate-view').lastLocation.fraction)
        const from = await at()
        const moved = await watchMove(page, 'the page did not turn', async () => await at() > from)
        if (!await press(page, 0.9, setup.touch)) fail('no frame shows the page to tap')
        await moved()
        const early = await sentBy(page)
        if (early.length) fail(`before the reader was ${how} it had already sent ${early.join(', ')}`)
        await leave(page)
        // Long enough for a second request the page would have sent, had it lived.
        await pause(3000)
        const place = await stored()
        if (place.savedAt === start.savedAt || place.fraction <= start.fraction) fail(`the reader ${how} right after a turn did not save it: ${JSON.stringify(place)}`)
        const data = await userData()
        const ticks = Math.round(place.fraction * 1e7)
        if (data.PlaybackPositionTicks !== ticks || exactly(data.LastPlayedDate) !== exactly(place.savedAt)) fail(`the reader ${how} right after a turn left Jellyfin at ${data.PlaybackPositionTicks} (${data.LastPlayedDate}), not ${ticks} (${place.savedAt})`)
        // From another page of the same browser, as the reader's has gone.
        const after = await context.newPage()
        await after.goto(`${base}/Oriel/licenses.html`)
        const sent = await sentBy(after)
        if (sent.length !== 1 || !sent[0].startsWith('PUT ')) fail(`the reader ${how} right after a turn sent ${sent.join(', ') || 'nothing'}`)
        if ((await resumed())?.UserData?.PlaybackPositionTicks !== ticks) fail(`with the reader ${how}, Resume does not list the book at the new place`)
        pass(`the reader ${how} right after a page turn sends one request, and Oriel, Jellyfin and Resume all have the new place (${Math.round(place.fraction * 100)}%)`)
        await context.close()
    }
    await setUserData({ PlayCount: 0, IsFavorite: false })
} catch (error) {
    console.error(`FAIL: ${browserName}: ${error.message}`)
    failed = true
} finally {
    // WebKit can hang while closing; the result is already known, so stop waiting.
    await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 10_000))])
}
process.exit(failed ? 1 : 0)
