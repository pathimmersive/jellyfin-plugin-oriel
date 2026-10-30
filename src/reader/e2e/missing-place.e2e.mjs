// Checks, in Playwright WebKit, that the reader still opens a book whose newest
// saved place is not a place in it: at Jellyfin's place for the book, else at
// the saved place's own fraction, else at the start of the text, with a notice
// saying which. The opening is not saved; the first page turn hides the notice
// and saves a place that is in the book. Configured by environment:
// ORIEL_BASE (server URL including any BaseUrl), ORIEL_SERVER_ID,
// ORIEL_USER_ID, ORIEL_TOKEN, ORIEL_ITEM_ID, ORIEL_FIRST_TEXT (a line of the
// first chapter) and ORIEL_JELLYFIN_TEXT (the first line of chapter three, at
// 0.6 of the book). Exits non-zero on the first failed check.
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
const token = env('ORIEL_TOKEN')
const userId = env('ORIEL_USER_ID')
const itemId = env('ORIEL_ITEM_ID')
const firstText = env('ORIEL_FIRST_TEXT')
const jellyfinText = env('ORIEL_JELLYFIN_TEXT')
const credentials = JSON.stringify({
    Servers: [{
        Id: env('ORIEL_SERVER_ID'),
        AccessToken: token,
        UserId: userId,
        ManualAddress: new URL(base).origin,
        DateLastAccessed: Date.now(),
    }],
})
const authorization = `MediaBrowser Client="oriel-smoke", Device="smoke", DeviceId="oriel-smoke", Version="1.0.0", Token="${token}"`
// The test book has four chapters; a tenth spine item does not exist.
const MISSING_CFI = 'epubcfi(/6/20!/4/2/1:0)'

const fail = message => { throw new Error(message) }
const pass = message => console.log(`PASS: ${message}`)
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

const api = async (path, init = {}) => {
    const response = await fetch(`${base}${path}`, {
        ...init,
        headers: { Authorization: authorization, 'Content-Type': 'application/json', ...init.headers },
    })
    if (!response.ok) fail(`${init.method ?? 'GET'} ${path} returned ${response.status}`)
    const text = await response.text()
    return text ? JSON.parse(text) : null
}

// Jellyfin's place an hour ago, then a newer saved place that is not in the book.
const savePlaces = async (jellyfinTicks, savedFraction) => {
    await api(`/UserItems/${itemId}/UserData?userId=${userId}`, {
        method: 'POST',
        body: JSON.stringify({ PlaybackPositionTicks: jellyfinTicks, LastPlayedDate: new Date(Date.now() - 3_600_000).toISOString() }),
    })
    await api(`/Oriel/Positions/${itemId}`, { method: 'PUT', body: JSON.stringify({ cfi: MISSING_CFI, fraction: savedFraction }) })
}

const frameText = async page => {
    const texts = await Promise.all(page.frames().map(frame =>
        frame.evaluate(() => document.body?.innerText ?? '').catch(() => '')))
    return texts.join('\n')
}

const section = page => page.evaluate(() => document.querySelector('foliate-view').renderer.getContents()[0]?.index)

const browser = await webkit.launch()
let failed = false
try {
    const cases = [
        { label: "Jellyfin's place", ticks: 6_000_000, fraction: 0.3, notice: 'so it opened at 60%, where you were in Jellyfin.', text: jellyfinText },
        { label: "the saved place's own fraction", ticks: 0, fraction: 0.3, notice: 'so it opened at 30%, where you were.', sectionAtLeast: 1 },
        { label: 'the start', ticks: 0, fraction: 0, notice: 'so it opened at the start.', text: firstText },
    ]
    for (const c of cases) {
        await savePlaces(c.ticks, c.fraction)
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
        await context.addInitScript(value => {
            localStorage.setItem('jellyfin_credentials', value)
        }, credentials)
        const page = await context.newPage()
        const saves = []
        page.on('request', request => {
            if (request.method() === 'PUT' && request.url().includes(`/Oriel/Positions/${itemId}`)) saves.push(request.postData())
        })
        await page.goto(`${base}/Oriel/?id=${itemId}`)
        await page.waitForSelector('body[data-state="rendered"], body[data-state="error"]', { timeout: 30_000 })
            .catch(() => fail(`with ${c.label} to fall back to, the reader never reported rendered or error`))
        if (await page.evaluate(() => document.body.dataset.state) !== 'rendered') {
            fail(`with ${c.label} to fall back to, the reader shows an error: ${await page.locator('#status').innerText()}`)
        }

        const notice = page.getByRole('status').filter({ hasText: 'Your saved place is not in this copy of the book' })
        await notice.waitFor({ timeout: 10_000 }).catch(() => fail(`with ${c.label} to fall back to, no notice says the saved place is not in this copy`))
        const said = (await notice.innerText()).trim()
        if (said !== `Your saved place is not in this copy of the book, ${c.notice}`) fail(`the notice says "${said}"`)
        if (c.text) {
            let text = ''
            for (let i = 0; i < 20 && !text.includes(c.text); i++) {
                await pause(500)
                text = await frameText(page)
            }
            if (!text.includes(c.text)) fail(`with ${c.label} to fall back to, the book does not show "${c.text}"`)
        }
        if (c.sectionAtLeast !== undefined && (await section(page)) < c.sectionAtLeast) {
            fail(`with ${c.label} to fall back to, the book opened in section ${await section(page)}`)
        }
        pass(`a saved place not in the book opens at ${c.label}, saying "${said}"`)

        // Longer than the reader waits before saving a move.
        await pause(6000)
        if (saves.length) fail(`opening at the fallback place saved a position: ${saves.join(', ')}`)
        await page.keyboard.press('ArrowRight')
        await notice.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => fail('the notice is still showing after a page turn'))
        await pause(6000)
        const stored = await api(`/Oriel/Positions/${itemId}`)
        if (!saves.length || stored?.cfi === MISSING_CFI || !stored?.cfi) fail(`the page turn did not replace the saved place: ${JSON.stringify(stored)}`)
        pass(`the opening is not saved; a page turn hides the notice and saves ${stored.cfi} in place of the missing one`)
        await context.close()
    }
} catch (error) {
    console.error(`FAIL: ${error.message}`)
    failed = true
} finally {
    // WebKit can hang while closing; the result is already known, so stop waiting.
    await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 10_000))])
}
process.exit(failed ? 1 : 0)
