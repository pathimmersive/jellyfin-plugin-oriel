// Checks, in Playwright WebKit at a phone size, that the reader opens books in
// formats other than EPUB: the comic shows its first page (a red image), and
// after a page turn it is saved to Oriel and mirrored to Jellyfin, and opens
// again on the same page. Configured by environment: ORIEL_BASE (server URL
// including any BaseUrl), ORIEL_SERVER_ID, ORIEL_USER_ID, ORIEL_TOKEN and
// ORIEL_CBZ_ID. Exits non-zero on the first failed check.
import { devices, webkit } from 'playwright'

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

const fail = message => { throw new Error(message) }
const pass = message => console.log(`PASS: ${message}`)
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

const api = async path => {
    const response = await fetch(`${base}${path}`, { headers: { Authorization: authorization } })
    return response.ok ? response.json() : null
}

// The colour at the middle of the first loaded image in any of the book's frames.
const pageColour = async page => {
    for (const frame of page.frames()) {
        const colour = await frame.evaluate(() => {
            const image = [...document.images].find(img => img.complete && img.naturalWidth > 0)
            if (!image) return null
            const canvas = document.createElement('canvas')
            canvas.width = image.naturalWidth
            canvas.height = image.naturalHeight
            const context = canvas.getContext('2d')
            context.drawImage(image, 0, 0)
            return [...context.getImageData(image.naturalWidth / 2, image.naturalHeight / 2, 1, 1).data.slice(0, 3)]
        }).catch(() => null)
        if (colour) return colour
    }
    return null
}
// The first page of the generated comic (make-cbz.mjs).
const RED = [200, 30, 30]
const near = (a, b) => a && a.every((v, i) => Math.abs(v - b[i]) < 12)

const where = page => page.evaluate(() => document.querySelector('foliate-view').lastLocation?.cfi ?? null)

const open = async (context, id) => {
    const page = await context.newPage()
    await page.goto(`${base}/Oriel/?id=${id}`)
    await page.waitForSelector('body[data-state="rendered"], body[data-state="error"]', { timeout: 30_000 })
        .catch(() => fail(`the reader never reported rendered or error for ${id}`))
    if (await page.evaluate(() => document.body.dataset.state) !== 'rendered') {
        fail(`the reader shows an error for ${id}: ${await page.locator('#status').innerText()}`)
    }
    return page
}

const browser = await webkit.launch()
let failed = false
try {
    const context = await browser.newContext({ ...devices['iPhone 13'], hasTouch: false })
    await context.addInitScript(value => {
        localStorage.setItem('jellyfin_credentials', value)
    }, credentials)
    const id = env('ORIEL_CBZ_ID')

    let page = await open(context, id)
    let colour = null
    for (let i = 0; i < 20 && !near(colour, RED); i++) {
        await pause(500)
        colour = await pageColour(page)
    }
    if (!near(colour, RED)) fail(`the comic opened but does not show its first page (red); the page colour is ${colour}`)
    pass('the comic opens in Oriel and shows its first page')

    const before = await where(page)
    await page.keyboard.press('ArrowRight')
    await pause(1500)
    const turned = await where(page)
    if (!turned || turned === before) fail(`turning a page in the comic left it at ${before}`)
    // Longer than the reader waits before saving a move.
    await pause(6000)
    const stored = await api(`/Oriel/Positions/${id}`)
    if (stored?.cfi !== turned) fail(`the comic's place ${turned} was not saved: ${JSON.stringify(stored)}`)
    const mirrored = await api(`/UserItems/${id}/UserData?userId=${userId}`)
    if (!(mirrored?.PlaybackPositionTicks > 0)) fail(`the comic's place was not mirrored to Jellyfin: ${JSON.stringify(mirrored)}`)
    await page.close()

    page = await open(context, id)
    let reopened = null
    for (let i = 0; i < 10 && reopened !== turned; i++) {
        await pause(500)
        reopened = await where(page)
    }
    if (reopened !== turned) fail(`the comic reopened at ${reopened}, not ${turned}`)
    pass(`a page turned in the comic is saved, mirrored to Jellyfin, and opens again at ${turned}`)
} catch (error) {
    console.error(`FAIL: ${error.message}`)
    failed = true
} finally {
    // WebKit can hang while closing; the result is already known, so stop waiting.
    await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 10_000))])
}
process.exit(failed ? 1 : 0)
