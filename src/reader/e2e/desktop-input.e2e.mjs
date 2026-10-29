// Checks, on a 1280x800 desktop page with a mouse and keyboard, that the reader
// turns pages the desktop way: the arrow keys, Space, Page Up and Page Down,
// with focus on the reader page and inside the book's text; a click on the left
// or right edge but not in the middle or at the end of a text selection; and
// the mouse wheel and a horizontal trackpad swipe, one page per gesture. A key
// turn is saved like a swipe. Runs in the browser named by ORIEL_BROWSER
// (webkit or chromium). Configured by environment: ORIEL_BASE (server URL
// including any BaseUrl), ORIEL_SERVER_ID, ORIEL_USER_ID, ORIEL_TOKEN and
// ORIEL_ITEM_ID. Exits non-zero on the first failed check.
import { chromium, webkit } from 'playwright'

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
const engines = { chromium, webkit }
if (!engines[browserName]) {
    console.error(`FAIL: ORIEL_BROWSER is '${browserName}', expected webkit or chromium`)
    process.exit(2)
}

const fail = message => { throw new Error(message) }
const pass = message => console.log(`PASS: ${browserName}: ${message}`)
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

// The page shown, as "<section index>:<page>".
const position = page => page.evaluate(() => {
    const renderer = document.querySelector('foliate-view').renderer
    return `${renderer.getContents()[0]?.index}:${renderer.page}`
})

// Turns the view itself, to learn where one page in a direction leads.
const turnView = (page, direction) => page.evaluate(direction =>
    document.querySelector('foliate-view')[direction](), direction)

const opposite = { next: 'prev', prev: 'next' }

// Runs `act` and checks it turns exactly one page in `direction` (next or prev)
// or, with direction null, none: the page it shows once the input settles is
// the one the view's own turn leads to.
const expectTurn = async (page, label, direction, act) => {
    const before = await position(page)
    let expected = before
    if (direction) {
        await turnView(page, direction)
        expected = await position(page)
        await turnView(page, opposite[direction])
        if (await position(page) !== before) fail(`could not return to ${before} before checking ${label}`)
        if (expected === before) fail(`there is no page ${direction} of ${before} to check ${label} with`)
    }
    await act()
    // Long enough for a stray second turn from the same gesture to show.
    await pause(1200)
    const after = await position(page)
    if (after !== expected) {
        fail(direction
            ? `${label} went from ${before} to ${after}, expected one page ${direction} to ${expected}`
            : `${label} moved the page from ${before} to ${after}`)
    }
    pass(direction ? `${label} turns one page ${direction}, ${before} to ${after}` : `${label} leaves the page at ${before}`)
    if (direction) {
        await turnView(page, opposite[direction])
        await pause(200)
    }
}

// The reader's area on the page, for clicks and the wheel.
const box = async page => {
    const rect = await page.locator('#book').boundingBox()
    if (!rect) fail('the book has no box on the page')
    return rect
}

// A frame holding a section of the book.
const bookFrame = page => page.frames().find(frame => frame !== page.mainFrame())

const browser = await engines[browserName].launch()
let failed = false
try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    await context.addInitScript(value => {
        localStorage.setItem('jellyfin_credentials', value)
    }, credentials)
    const page = await context.newPage()
    await page.goto(`${base}/Oriel/?id=${itemId}`)
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 })
        .catch(() => fail('the reader did not render the book'))
    await pause(1000)
    const rect = await box(page)
    const middle = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }

    // A key turn is a reader move: the new position is written to Oriel's store.
    const saved = page.waitForRequest(request =>
        request.method() !== 'GET' && request.url().includes(`/Oriel/Positions/${itemId}`), { timeout: 15_000 })
        .catch(() => null)
    await expectTurn(page, 'ArrowRight on the reader page', 'next', () => page.keyboard.press('ArrowRight'))
    if (!await saved) fail('turning the page with ArrowRight saved no position to /Oriel/Positions')
    pass('a page turned with ArrowRight is saved to /Oriel/Positions')

    // Start a page in, so a previous page exists.
    await turnView(page, 'next')
    await pause(200)

    await expectTurn(page, 'ArrowLeft on the reader page', 'prev', () => page.keyboard.press('ArrowLeft'))
    await expectTurn(page, 'Space', 'next', () => page.keyboard.press('Space'))
    await expectTurn(page, 'Shift+Space', 'prev', () => page.keyboard.press('Shift+Space'))
    await expectTurn(page, 'PageDown', 'next', () => page.keyboard.press('PageDown'))
    await expectTurn(page, 'PageUp', 'prev', () => page.keyboard.press('PageUp'))
    await expectTurn(page, 'Control+ArrowRight', null, () => page.keyboard.press('Control+ArrowRight'))

    // A click in the middle turns nothing; it also puts focus inside the book.
    await expectTurn(page, 'a click in the middle of the page', null, () => page.mouse.click(middle.x, middle.y))
    const frame = bookFrame(page)
    if (!frame) fail('the book has no section frame')
    await frame.evaluate(() => window.focus())
    await expectTurn(page, 'ArrowRight inside the book', 'next', () => page.keyboard.press('ArrowRight'))
    await expectTurn(page, 'ArrowLeft inside the book', 'prev', () => page.keyboard.press('ArrowLeft'))
    await expectTurn(page, 'Space inside the book', 'next', () => page.keyboard.press('Space'))

    await expectTurn(page, 'a click on the right edge', 'next', () => page.mouse.click(rect.x + rect.width * 0.92, middle.y))
    await expectTurn(page, 'a click on the left edge', 'prev', () => page.mouse.click(rect.x + rect.width * 0.08, middle.y))
    // The drag runs on the first spread, where both columns hold text. On the
    // chapter's last spread the right column is empty, and WebKit maps a drag
    // into it to an earlier place in the text, so foliate-js pages back to
    // follow the selection; that is not a click.
    await turnView(page, 'prev')
    await pause(200)
    await expectTurn(page, 'a drag that selects text and ends on the right edge', null, async () => {
        await page.mouse.move(rect.x + rect.width * 0.3, middle.y)
        await page.mouse.down()
        for (let step = 1; step <= 10; step++) {
            await page.mouse.move(rect.x + rect.width * (0.3 + 0.062 * step), middle.y)
            await pause(20)
        }
        await page.mouse.up()
    })
    await page.mouse.click(middle.x, middle.y)
    await turnView(page, 'next')
    await pause(200)

    await page.mouse.move(middle.x, middle.y)
    await expectTurn(page, 'one mouse wheel notch down', 'next', () => page.mouse.wheel(0, 100))
    await expectTurn(page, 'one mouse wheel notch up', 'prev', () => page.mouse.wheel(0, -100))
    const swipe = async dx => {
        // A trackpad swipe: a run of small deltas, then its momentum fading out.
        for (const delta of [4, 8, 14, 20, 24, 24, 20, 16, 12, 9, 6, 4, 3, 2, 1, 1]) {
            await page.mouse.wheel(Math.sign(dx) * delta, 0)
            await pause(16)
        }
    }
    await expectTurn(page, 'a two-finger swipe to the left on a trackpad', 'next', () => swipe(1))
    await expectTurn(page, 'a two-finger swipe to the right on a trackpad', 'prev', () => swipe(-1))
} catch (error) {
    console.error(`FAIL: ${browserName}: ${error.message}`)
    failed = true
} finally {
    // WebKit can hang while closing; the result is already known, so stop waiting.
    await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 10_000))])
}
process.exit(failed ? 1 : 0)
