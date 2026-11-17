// Checks the reader's controls in the browser named by ORIEL_BROWSER: webkit at
// iPhone size with touch, or chromium at desktop size with a mouse. While
// reading, a footer shows the chapter and the percent read. A tap or click in
// the middle shows the controls: a header with Back to Jellyfin, the book's
// title and More, and a footer with the chapter, the percent and a position
// slider. More links to Your reading data and the book's details; a tap outside
// it closes it. Releasing the slider moves the book, saved to Oriel and
// mirrored to Jellyfin. A second tap in the middle, or a page turn, hides the
// controls, and the edges still turn pages. Configured by environment:
// ORIEL_BASE (server URL including any BaseUrl), ORIEL_SERVER_ID,
// ORIEL_USER_ID, ORIEL_TOKEN, ORIEL_ITEM_ID and ORIEL_BROWSER. Exits non-zero
// on the first failed check.
import { chromium, devices, webkit } from 'playwright'
import { press as pressAt } from './press.mjs'
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
const credentials = JSON.stringify({
    Servers: [{
        Id: env('ORIEL_SERVER_ID'),
        AccessToken: env('ORIEL_TOKEN'),
        UserId: env('ORIEL_USER_ID'),
        ManualAddress: new URL(base).origin,
        DateLastAccessed: Date.now(),
    }],
})
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

const CHAPTERS = ['Chapter One', 'Chapter Two', 'Chapter Two, Second Half', 'Chapter Three', 'Chapter Four']
const detailsUrl = `${base}/web/#/details?id=${itemId}`

// The page shown, as "<section index>:<page>".
const position = page => page.evaluate(() => {
    const renderer = document.querySelector('foliate-view').renderer
    return `${renderer.getContents()[0]?.index}:${renderer.page}`
})

const press = async (page, share) => {
    if (!await pressAt(page, share, setup.touch)) fail('no frame shows the page to tap')
}

const shown = page => page.locator('#controls header').isVisible()

const browser = await setup.engine.launch()
let failed = false
try {
    const context = await browser.newContext(setup.context)
    await context.addInitScript(value => {
        localStorage.setItem('jellyfin_credentials', value)
        // The reading gestures hint was seen on this device before.
        localStorage.setItem('oriel-hints', JSON.stringify({ first: true, scroll: true }))
    }, credentials)
    const page = await context.newPage()
    await page.goto(`${base}/Oriel/?id=${itemId}`)
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 })
        .catch(() => fail('the reader did not render the book'))

    // While reading: the chapter and the percent, and no controls.
    const reading = page.locator('#reading-footer')
    if (!await reading.isVisible()) fail('no reading footer shows while reading')
    const percent = await until(async () => {
        const text = (await reading.locator('.progress').innerText()).trim()
        return /^\d{1,3}%$/.test(text) && text
    }, async () => `the reading footer's progress is '${(await reading.locator('.progress').innerText()).trim()}'`)
    const chapter = (await reading.locator('.chapter').innerText()).trim()
    if (!CHAPTERS.includes(chapter)) fail(`the reading footer's chapter is '${chapter}'`)
    if (!/^\d{1,3}%$/.test(percent)) fail(`the reading footer's progress is '${percent}'`)
    if (await shown(page)) fail('the controls show before the middle is tapped')
    pass(`while reading, the footer shows '${chapter}' and ${percent}, and the controls are hidden`)

    // A tap in the middle shows the header and footer.
    const before = await position(page)
    await press(page, 0.5)
    await until(() => shown(page), 'a tap in the middle did not show the controls')
    if (await position(page) !== before) fail('a tap in the middle turned the page')
    const title = (await page.locator('#controls header .title').innerText()).trim()
    if (title !== 'Oriel Smoke Book') fail(`the header's title is '${title}'`)
    const back = page.getByRole('link', { name: 'Back to the book in Jellyfin' })
    if (await back.evaluate(a => a.href) !== detailsUrl) fail(`Back to Jellyfin goes to ${await back.evaluate(a => a.href)}, expected ${detailsUrl}`)
    const footer = page.locator('#controls footer')
    if ((await footer.locator('.chapter').innerText()).trim() !== chapter) fail('the controls\' footer does not show the chapter')
    if (!/^\d{1,3}%$/.test((await footer.locator('.progress').innerText()).trim())) fail('the controls\' footer does not show the percent')
    const slider = page.getByRole('slider', { name: 'Position in the book' })
    if (!await slider.isVisible()) fail('the controls\' footer has no position slider')
    for (const control of await page.locator('#controls button, #controls a').all()) {
        const size = await control.boundingBox()
        const name = await control.getAttribute('aria-label') ?? await control.innerText()
        if (!name.trim()) fail('a control has no accessible name')
        if (size && (size.width < 44 || size.height < 44)) fail(`'${name}' is ${size.width}x${size.height}, under 44 px`)
    }
    pass(`a tap in the middle shows the header ('${title}', Back to ${detailsUrl}) and the footer with the chapter, percent and slider`)

    // More lists its links; a tap outside closes it and leaves the page.
    await page.getByRole('button', { name: 'More' }).click()
    const data = page.getByRole('link', { name: 'Your reading data' })
    const details = page.getByRole('link', { name: 'Book details in Jellyfin' })
    if (!await data.isVisible() || !await details.isVisible()) fail('More does not list Your reading data and Book details in Jellyfin')
    const dataUrl = `${base}/Oriel/data.html?id=${itemId}`
    if (await data.evaluate(a => a.href) !== dataUrl) fail(`Your reading data goes to ${await data.evaluate(a => a.href)}, expected ${dataUrl}`)
    if (await details.evaluate(a => a.href) !== detailsUrl) fail(`Book details goes to ${await details.evaluate(a => a.href)}`)
    const licenses = page.getByRole('link', { name: 'Licenses' })
    const licensesUrl = `${base}/Oriel/licenses.html?id=${itemId}`
    if (!await licenses.isVisible()) fail('More does not list Licenses')
    if (await licenses.evaluate(a => a.href) !== licensesUrl) fail(`Licenses goes to ${await licenses.evaluate(a => a.href)}, expected ${licensesUrl}`)
    // The Licenses page shows Oriel's license and the third-party notices under the reader's policy.
    const licensesPage = await page.context().newPage()
    const licensesResponse = await licensesPage.goto(licensesUrl)
    const licensesPolicy = (await licensesResponse.allHeaders())['content-security-policy'] ?? ''
    if (!/script-src 'self'(;|$)/.test(licensesPolicy)) fail(`the Licenses page's Content-Security-Policy is '${licensesPolicy}'`)
    await until(async () => (await licensesPage.locator('#license').innerText()).includes('GNU GENERAL PUBLIC LICENSE'),
        'the Licenses page does not show the GNU General Public License')
    const noticesText = await licensesPage.locator('#notices').innerText()
    for (const name of ['foliate-js', 'PDF.js', 'WordNet', 'SIL Open Font License']) {
        if (!noticesText.includes(name)) fail(`the Licenses page's notices do not name ${name}`)
    }
    const licensesBack = await licensesPage.locator('#back').evaluate(a => a.href)
    if (licensesBack !== `${base}/Oriel/?id=${itemId}`) fail(`the Licenses page's Back goes to ${licensesBack}`)
    await licensesPage.close()
    await page.locator('#more-backdrop').click({ position: { x: 20, y: 300 } })
    await until(async () => !await data.isVisible(), 'a tap outside More did not close it')
    if (!await shown(page)) fail('a tap outside More hid the controls')
    if (await position(page) !== before) fail('a tap outside More turned the page')
    pass("More links to Your reading data, the book's details and Licenses, whose page shows the GPL and the notices under the reader's policy, and a tap outside closes it without turning")

    // Releasing the slider moves the book, saved and mirrored, controls kept.
    // The target is far from where the book is, so the move is a real one: a
    // release on the page already shown is not a move and saves nothing.
    const [target, targetChapter] = parseInt(percent, 10) < 40 ? ['60', 'Chapter Three'] : ['10', 'Chapter One']
    const stored = page.waitForRequest(request => request.method() === 'PUT' && request.url().includes(`/Oriel/Positions/${itemId}`), { timeout: 15_000 }).catch(() => null)
    const mirrored = page.waitForRequest(request => request.method() === 'POST' && request.url().includes(`/UserItems/${itemId}/UserData`), { timeout: 15_000 }).catch(() => null)
    await slider.fill(target)
    await slider.dispatchEvent('change')
    const chapterShown = async () => (await footer.locator('.chapter').innerText()).trim()
    await until(async () => await chapterShown() === targetChapter, async () => `the slider at ${target}% shows '${await chapterShown()}', expected ${targetChapter}`)
    if (!await shown(page)) fail('moving the slider hid the controls')
    if (!await stored) fail('the slider\'s move was not saved to /Oriel/Positions')
    if (!await mirrored) fail('the slider\'s move was not mirrored to Jellyfin')
    pass(`releasing the slider at ${target}% moves to ${targetChapter}, saved to Oriel and mirrored to Jellyfin, with the controls kept`)

    // A second tap in the middle hides them; a page turn hides them too.
    await press(page, 0.5)
    await until(async () => !await shown(page), 'a second tap in the middle did not hide the controls')
    await press(page, 0.5)
    await until(() => shown(page), 'a third tap in the middle did not show the controls again')
    const shownAt = await position(page)
    const turnedOver = await watchMove(page, 'a tap on the right edge did not turn the page')
    await press(page, 0.9)
    await turnedOver()
    await until(async () => await position(page) !== shownAt, 'a tap on the right edge did not turn the page')
    await until(async () => !await shown(page), 'turning a page did not hide the controls')
    // The paginator ignores a turn that comes within 100 ms of the last one ending.
    await pause(150)
    pass('a second tap in the middle hides the controls, and a tap on the edge turns the page and hides them')

    // The edge zones: 30% for touch, 22% for the mouse.
    const edgeAt = await position(page)
    if (setup.touch) {
        const edgeTurn = await watchMove(page, 'a tap at 25% did not turn the page')
        await press(page, 0.25)
        await edgeTurn()
        await until(async () => await position(page) !== edgeAt, 'a tap at 25% did not turn the page')
    } else {
        await press(page, 0.25)
        await until(() => shown(page), 'a click at 25% did not show the controls without turning')
        if (await position(page) !== edgeAt) fail('a click at 25% did not show the controls without turning')
    }
    pass(setup.touch ? 'a tap at 25% of the width turns the page (touch edges are 30%)' : 'a click at 25% of the width shows the controls (mouse edges are 22%)')
} catch (error) {
    console.error(`FAIL: ${browserName}: ${error.message}`)
    failed = true
} finally {
    // WebKit can hang while closing; the result is already known, so stop waiting.
    await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 10_000))])
}
process.exit(failed ? 1 : 0)
