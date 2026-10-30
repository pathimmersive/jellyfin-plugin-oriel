// Checks, in Playwright WebKit at a phone size, that the reader opens books in
// formats other than EPUB: the comic shows its first page (a red image), the
// MOBI and AZW3 books their first chapter's text and the PDF its first page's
// text, and after a page turn each is saved to Oriel and mirrored to Jellyfin,
// and opens again on the same page. Only the PDF fetches PDF.js. Configured by
// environment: ORIEL_BASE (server URL including any BaseUrl), ORIEL_SERVER_ID,
// ORIEL_USER_ID, ORIEL_TOKEN, ORIEL_CBZ_ID, ORIEL_MOBI_ID, ORIEL_MOBI_TEXT,
// ORIEL_AZW3_ID, ORIEL_AZW3_TEXT, ORIEL_PDF_ID and ORIEL_PDF_TEXT (each book's
// first line). Exits non-zero on the first failed check.
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

// The book renders in iframes inside a closed shadow root, so read every frame.
const frameText = async page => {
    const texts = await Promise.all(page.frames().map(frame =>
        frame.evaluate(() => document.body?.innerText ?? '').catch(() => '')))
    return texts.join('\n')
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

// Waits for a page to show what `seen` looks for; true once it does.
const shows = async (page, seen) => {
    for (let i = 0; i < 20; i++) {
        if (await seen(page)) return true
        await pause(500)
    }
    return false
}
const showsText = text => async page => (await frameText(page)).includes(text)

const where = page => page.evaluate(() => document.querySelector('foliate-view').lastLocation?.cfi ?? null)

// PDF.js, its worker and the PDF adapter's chunk, none of which other books need.
const PDF_FILES = /\/pdfjs\/|pdf\.worker|\/pdf-[\w-]+\.js/

const open = async (context, id, fetched = []) => {
    const page = await context.newPage()
    page.on('request', request => fetched.push(request.url()))
    await page.goto(`${base}/Oriel/?id=${id}`)
    await page.waitForSelector('body[data-state="rendered"], body[data-state="error"]', { timeout: 30_000 })
        .catch(() => fail(`the reader never reported rendered or error for ${id}`))
    if (await page.evaluate(() => document.body.dataset.state) !== 'rendered') {
        fail(`the reader shows an error for ${id}: ${await page.locator('#status').innerText()}`)
    }
    return page
}

const books = [
    { label: 'comic', id: env('ORIEL_CBZ_ID'), first: 'its first page (red)', seen: async page => near(await pageColour(page), RED) },
    { label: 'MOBI book', id: env('ORIEL_MOBI_ID'), first: `"${env('ORIEL_MOBI_TEXT')}"`, seen: showsText(env('ORIEL_MOBI_TEXT')) },
    { label: 'AZW3 book', id: env('ORIEL_AZW3_ID'), first: `"${env('ORIEL_AZW3_TEXT')}"`, seen: showsText(env('ORIEL_AZW3_TEXT')) },
    { label: 'PDF', id: env('ORIEL_PDF_ID'), first: `"${env('ORIEL_PDF_TEXT')}"`, seen: showsText(env('ORIEL_PDF_TEXT')), pdf: true },
]

const browser = await webkit.launch()
let failed = false
try {
    const context = await browser.newContext({ ...devices['iPhone 13'], hasTouch: false })
    await context.addInitScript(value => {
        localStorage.setItem('jellyfin_credentials', value)
    }, credentials)

    for (const book of books) {
        const fetched = []
        let page = await open(context, book.id, fetched)
        if (!await shows(page, book.seen)) fail(`the ${book.label} opened but does not show ${book.first}`)
        pass(`the ${book.label} opens in Oriel and shows ${book.first}`)
        const pdfFiles = fetched.filter(url => PDF_FILES.test(url))
        if (book.pdf && !pdfFiles.length) fail(`the ${book.label} showed without fetching PDF.js`)
        if (!book.pdf && pdfFiles.length) fail(`the ${book.label} fetched PDF.js files: ${pdfFiles.join(', ')}`)
        if (!book.pdf) pass(`the ${book.label} fetched no PDF.js file`)

        const before = await where(page)
        await page.keyboard.press('ArrowRight')
        await pause(1500)
        const turned = await where(page)
        if (!turned || turned === before) fail(`turning a page in the ${book.label} left it at ${before}`)
        // Longer than the reader waits before saving a move.
        await pause(6000)
        const stored = await api(`/Oriel/Positions/${book.id}`)
        if (stored?.cfi !== turned) fail(`the ${book.label}'s place ${turned} was not saved: ${JSON.stringify(stored)}`)
        const mirrored = await api(`/UserItems/${book.id}/UserData?userId=${userId}`)
        if (!(mirrored?.PlaybackPositionTicks > 0)) fail(`the ${book.label}'s place was not mirrored to Jellyfin: ${JSON.stringify(mirrored)}`)
        await page.close()

        page = await open(context, book.id)
        let reopened = null
        for (let i = 0; i < 10 && reopened !== turned; i++) {
            await pause(500)
            reopened = await where(page)
        }
        if (reopened !== turned) fail(`the ${book.label} reopened at ${reopened}, not ${turned}`)
        pass(`a page turned in the ${book.label} is saved, mirrored to Jellyfin, and opens again at ${turned}`)
        await page.close()
    }
} catch (error) {
    console.error(`FAIL: ${error.message}`)
    failed = true
} finally {
    // WebKit can hang while closing; the result is already known, so stop waiting.
    await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 10_000))])
}
process.exit(failed ? 1 : 0)
