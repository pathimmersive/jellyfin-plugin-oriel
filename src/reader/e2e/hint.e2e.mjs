// Checks the reading gestures hint in the browser named by ORIEL_BROWSER:
// webkit at iPhone size with touch, or chromium at desktop size with a mouse.
// On a device that has never opened a book, the hint shows over the test EPUB:
// on a touch screen the three tap zones with "Or swipe left and right to turn
// pages.", on a desktop the Turning pages dialog with its four tiles; Got it has
// focus, and a tap or click behind it does nothing. Got it closes it and a reload
// does not show it again. More's Show reading gestures brings it back, between
// Your reading data and Book details in Jellyfin, and Escape closes it. Choosing
// Scroll shows the Scroll hint once, with its zones top to bottom; choosing it
// again later does not. Nothing is requested from another host. Configured by
// environment: ORIEL_BASE (server URL including any BaseUrl), ORIEL_SERVER_ID,
// ORIEL_USER_ID, ORIEL_TOKEN, ORIEL_ITEM_ID (the test EPUB) and ORIEL_BROWSER.
// Exits non-zero on the first failed check.
import { chromium, devices, webkit } from 'playwright'
import { press as pressAt } from './press.mjs'

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
const credentials = JSON.stringify({
    Servers: [{
        Id: env('ORIEL_SERVER_ID'),
        AccessToken: env('ORIEL_TOKEN'),
        UserId: env('ORIEL_USER_ID'),
        ManualAddress: origin,
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
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

const PAGED_ZONES = ['Previous page', 'Show the controls', 'Next page']
const SCROLL_ZONES = ['Scroll up a screen', 'Show the controls', 'Scroll down a screen']
const TILES = [
    ['Arrow keys or Space', 'The left and right arrow keys, or Space, turn the page'],
    ['Mouse wheel', 'Scrolling the mouse wheel turns the page'],
    ['Two-finger swipe', 'A two-finger swipe on a trackpad turns the page'],
    ['Click an edge - the middle shows the controls', 'Clicking the left or right edge turns the page; clicking the middle shows the controls'],
]
const SCROLL_LINE = setup.touch ? 'Or drag up and down to scroll freely.' : 'Or use the mouse wheel or arrow keys to scroll freely.'

const hint = page => page.getByRole('dialog', { name: setup.touch ? 'Reading gestures' : 'Turning pages' })
const scrollHint = page => page.getByRole('dialog', { name: 'Reading gestures' })

const position = page => page.evaluate(() => {
    const renderer = document.querySelector('foliate-view').renderer
    return `${renderer.getContents()[0]?.index}:${Math.round(renderer.start)}`
})

const open = async page => {
    await page.goto(`${base}/Oriel/?id=${itemId}`)
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 })
        .catch(() => fail('the reader did not render the test EPUB'))
    await pause(1200)
}

// The zones' names in order, and the line under them.
const zones = async dialog => ({
    names: (await dialog.locator('.zone').allInnerTexts()).map(text => text.trim()),
    line: (await dialog.locator('.hint-line').innerText()).trim(),
})

const gotItFocused = page => page.evaluate(() => document.activeElement?.textContent?.trim() === 'Got it')

const browser = await setup.engine.launch()
let failed = false
try {
    const context = await browser.newContext(setup.context)
    await context.addInitScript(value => {
        localStorage.setItem('jellyfin_credentials', value)
    }, credentials)
    const elsewhere = []
    context.on('request', request => {
        const url = request.url()
        if (/^https?:/.test(url) && new URL(url).origin !== origin) elsewhere.push(url)
    })
    const page = await context.newPage()
    await open(page)

    // The first open on this device shows the hint for this screen.
    const dialog = hint(page)
    if (!await dialog.isVisible()) fail('no reading gestures hint on the first open')
    if (setup.touch) {
        const shown = await zones(dialog)
        if (shown.names.join(', ') !== PAGED_ZONES.join(', ')) fail(`the hint's zones are ${shown.names.join(', ')}`)
        if (shown.line !== 'Or swipe left and right to turn pages.') fail(`the hint says '${shown.line}'`)
        pass(`the first open shows the tap zones ${PAGED_ZONES.join(', ')} and '${shown.line}'`)
    } else {
        const heading = (await dialog.locator('h2').innerText()).trim()
        if (heading !== 'Turning pages') fail(`the desktop hint is titled '${heading}'`)
        for (const [caption, description] of TILES) {
            const tile = dialog.getByRole('img', { name: description, exact: true })
            if (!await tile.isVisible()) fail(`the desktop hint has no tile '${description}'`)
            if (!(await tile.innerText()).includes(caption)) fail(`the tile '${description}' is not captioned '${caption}'`)
        }
        pass(`the first open shows the Turning pages dialog with its four tiles`)
    }
    if (!await gotItFocused(page)) fail('Got it does not have focus')

    // A tap or click behind it does nothing.
    const before = await position(page)
    const book = await page.locator('#book').boundingBox()
    await page.mouse.click(book.x + book.width * 0.85, book.y + book.height * 0.5)
    await pause(800)
    if (await position(page) !== before) fail(`a ${setup.touch ? 'tap' : 'click'} behind the hint moved the book from ${before} to ${await position(page)}`)
    if (await page.locator('#controls header').isVisible()) fail('a tap behind the hint showed the controls')
    if (!await dialog.isVisible()) fail('a tap behind the hint closed it')
    pass(`a ${setup.touch ? 'tap' : 'click'} behind the hint does nothing, and Got it has focus`)

    // Got it closes it, and this device remembers.
    await dialog.getByRole('button', { name: 'Got it' }).click()
    await pause(400)
    if (await dialog.isVisible()) fail('Got it did not close the hint')
    if (await position(page) !== before) fail('closing the hint moved the book')
    await open(page)
    if (await hint(page).isVisible()) fail('the hint showed again after a reload')
    pass('Got it closes the hint, and a reload does not show it again')

    // More brings it back; Escape closes it.
    if (!await pressAt(page, 0.5, setup.touch)) fail('no frame shows the page to tap')
    await pause(600)
    await page.getByRole('button', { name: 'More' }).click()
    await pause(300)
    const items = (await page.locator('#more a, #more button').allInnerTexts()).map(text => text.trim())
    const at = items.indexOf('Show reading gestures')
    if (at < 0 || items[at - 1] !== 'Your reading data' || items[at + 1] !== 'Book details in Jellyfin') fail(`More lists ${items.join(', ')}`)
    await page.getByText('Show reading gestures', { exact: true }).click()
    await pause(400)
    if (!await hint(page).isVisible()) fail('Show reading gestures did not show the hint')
    if (await page.locator('#more').isVisible()) fail('Show reading gestures left More open')
    await page.keyboard.press('Escape')
    await pause(300)
    if (await hint(page).isVisible()) fail('Escape did not close the hint')
    pass('More lists Show reading gestures between Your reading data and Book details, it shows the hint, and Escape closes it')

    // The first choice of Scroll shows the Scroll hint once.
    if (!await page.locator('#controls header').isVisible()) {
        if (!await pressAt(page, 0.5, setup.touch)) fail('no frame shows the page to tap')
        await pause(600)
    }
    const choose = async name => {
        if (!await page.locator('#prefs').isVisible()) {
            if (!await page.locator('#controls header').isVisible()) {
                await pressAt(page, 0.5, setup.touch)
                await pause(600)
            }
            await page.getByRole('button', { name: 'Preferences' }).click()
            await pause(400)
        }
        await page.locator('#prefs').getByRole('group', { name: 'Page turn' }).getByRole('button', { name, exact: true }).click()
        await pause(1200)
    }
    await choose('Scroll')
    const scrolling = scrollHint(page)
    if (!await scrolling.isVisible()) fail('choosing Scroll did not show the Scroll hint')
    const shown = await zones(scrolling)
    if (shown.names.join(', ') !== SCROLL_ZONES.join(', ')) fail(`the Scroll hint's zones are ${shown.names.join(', ')}`)
    if (shown.line !== SCROLL_LINE) fail(`the Scroll hint says '${shown.line}', expected '${SCROLL_LINE}'`)
    const [top, bottom] = await scrolling.locator('.zone').evaluateAll(zones => [zones[0].getBoundingClientRect().top, zones[2].getBoundingClientRect().top])
    if (!(bottom > top)) fail('the Scroll hint\'s zones are not top to bottom')
    await scrolling.getByRole('button', { name: 'Got it' }).click()
    await pause(400)
    await choose('Slide')
    await choose('Scroll')
    if (await scrollHint(page).isVisible()) fail('the Scroll hint showed again on choosing Scroll a second time')
    await choose('Slide')
    pass(`choosing Scroll shows ${SCROLL_ZONES.join(', ')} and '${SCROLL_LINE}' once, and not again`)

    if (elsewhere.length) fail(`requests went to other hosts: ${[...new Set(elsewhere)].join(', ')}`)
    pass(`no request went to any host but ${origin}`)
} catch (error) {
    console.error(`FAIL: ${browserName}: ${error.message}`)
    failed = true
} finally {
    // WebKit can hang while closing; the result is already known, so stop waiting.
    await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 10_000))])
}
process.exit(failed ? 1 : 0)
