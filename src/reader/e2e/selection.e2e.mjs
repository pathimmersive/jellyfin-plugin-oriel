// Checks, in Playwright WebKit with an iPhone viewport and touch, that a
// one-finger drag across the page leaves it where it is while text is selected
// (so the drag can extend the selection) and still turns the page when nothing
// is selected. Configured by environment: ORIEL_BASE (server URL including any
// BaseUrl), ORIEL_SERVER_ID, ORIEL_USER_ID, ORIEL_TOKEN and ORIEL_ITEM_ID.
// Exits non-zero on the first failed check.
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

const fail = message => { throw new Error(message) }
const pass = message => console.log(`PASS: ${message}`)

// Drags one finger from right to left across the section document, the way a
// swipe or a selection-handle drag arrives, and reports the position before and
// after, and whether anything cancelled the moves. Touch events are built by
// hand because desktop WebKit has no Touch constructor; the paginator only reads
// the fields set here.
const drag = (page, select) => page.evaluate(async select => {
    const renderer = document.querySelector('foliate-view').renderer
    const { doc, index } = renderer.getContents()[0]
    const position = () => `${renderer.getContents()[0]?.index}:${renderer.page}`
    const selection = doc.getSelection()
    selection.removeAllRanges()
    if (select) {
        const range = doc.createRange()
        range.selectNodeContents(doc.querySelector('p'))
        selection.addRange(range)
    }
    const before = position()
    let cancelled = false
    const fire = (type, x) => {
        const touch = { identifier: 1, target: doc.body, screenX: x, screenY: 400, clientX: x, clientY: 400 }
        const event = new Event(type, { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'changedTouches', { value: [touch] })
        Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : [touch] })
        doc.body.dispatchEvent(event)
        cancelled ||= event.defaultPrevented
    }
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
    fire('touchstart', 320)
    for (let x = 300; x >= 40; x -= 20) {
        await pause(10)
        fire('touchmove', x)
    }
    fire('touchend', 40)
    await pause(1500)
    const after = position()
    selection.removeAllRanges()
    return { before, after, cancelled, index }
}, select)

const browser = await webkit.launch()
let failed = false
try {
    const context = await browser.newContext({ ...devices['iPhone 13'] })
    await context.addInitScript(value => {
        localStorage.setItem('jellyfin_credentials', value)
    }, credentials)
    const page = await context.newPage()
    await page.goto(`${base}/Oriel/?id=${itemId}`)
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 })
        .catch(() => fail('the reader did not render the book'))

    const selected = await drag(page, true)
    if (selected.after !== selected.before) {
        fail(`with text selected, a one-finger drag moved the page from ${selected.before} to ${selected.after}`)
    }
    if (selected.cancelled) fail('with text selected, the drag was cancelled, so iOS could not move the selection handle')
    pass(`with text selected, a one-finger drag at ${base} leaves the page at ${selected.before} and is not cancelled`)

    const swiped = await drag(page, false)
    if (swiped.after === swiped.before) {
        fail(`with nothing selected, a one-finger swipe left the page at ${swiped.before}`)
    }
    pass(`with nothing selected, the same swipe at ${base} turns the page from ${swiped.before} to ${swiped.after}`)
} catch (error) {
    console.error(`FAIL: ${error.message}`)
    failed = true
} finally {
    // WebKit can hang while closing; the result is already known, so stop waiting.
    await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 10_000))])
}
process.exit(failed ? 1 : 0)
