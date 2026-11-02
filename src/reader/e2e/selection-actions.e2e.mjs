// Checks the Selected text toolbar's actions in the browser named by
// ORIEL_BROWSER: webkit at iPhone size with touch, or chromium at desktop size
// with a mouse. On the test EPUB, selecting text shows Copy, Translate, Search
// and Share below the highlighters; Copy puts the text on the clipboard (through
// the clipboard API, and the old way where the page is not secure, as on a
// server reached over plain http) and says Copied; Translate opens the text at
// the translation address the plugin's setting holds, and is gone when the
// setting is empty; Search opens Search in this book with it; Share hands it
// and the book's title to the share sheet, and is gone without one; a tapped
// highlight shows the same actions and Remove. Each action closes the toolbar
// and lets go of the selection without turning the page or showing the
// controls. The clipboard, the share sheet and the translation site are stood
// in for in the page, so nothing is copied, shared or fetched for real.
// Configured by environment: ORIEL_BASE (server URL including any BaseUrl),
// ORIEL_SERVER_ID, ORIEL_USER_ID, ORIEL_TOKEN, ORIEL_ITEM_ID (the test EPUB)
// and ORIEL_BROWSER. Exits non-zero on the first failed check.
import { chromium, devices, webkit } from 'playwright'
import { press, pressPoint } from './press.mjs'

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
const credentials = JSON.stringify({
    Servers: [{
        Id: env('ORIEL_SERVER_ID'),
        AccessToken: token,
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

// Presses a button or link as this screen's reader would: a tap on a touch screen, else a click.
const use = locator => setup.touch ? locator.tap() : locator.click()

const PLUGIN_ID = '2c488ea7-0cae-4499-a2a7-6bae27b4e8f6'
const GOOGLE = 'https://translate.google.com/?sl=auto&op=translate&text={text}'
const authorization = `MediaBrowser Client="oriel-e2e", Device="e2e", DeviceId="oriel-e2e-selection-actions", Version="1.0.0", Token="${token}"`
const call = async (path, init = {}) => {
    const response = await fetch(`${base}${path}`, { ...init, headers: { Authorization: authorization, 'Content-Type': 'application/json', ...init.headers } })
    if (!response.ok) fail(`${init.method ?? 'GET'} ${path} returned ${response.status}`)
    return response.status === 204 ? null : response.json()
}
// Sets the plugin's translation address, as an admin does.
const setTranslateUrl = async address => {
    const configuration = await call(`/Plugins/${PLUGIN_ID}/Configuration`)
    await call(`/Plugins/${PLUGIN_ID}/Configuration`, { method: 'POST', body: JSON.stringify({ ...configuration, TranslateUrl: address }) })
}
const clearHighlights = async () => {
    for (const highlight of await call(`/Oriel/Highlights/${itemId}`)) await call(`/Oriel/Highlights/${itemId}/${highlight.id}`, { method: 'DELETE' })
}

// Stands in for the clipboard and the share sheet: what is copied or shared is
// kept on the page. With `share` false the browser has no share sheet; with
// `secure` false the page is not secure, so the clipboard API is not offered.
const standIns = ({ share, secure }) => {
    window.copiedText = []
    window.sharedData = []
    if (secure) {
        Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.copiedText.push(text) } }, configurable: true })
    } else {
        Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
        Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
        const execCommand = document.execCommand.bind(document)
        document.execCommand = command => {
            if (command !== 'copy') return execCommand(command)
            window.copiedText.push(document.activeElement?.value)
            return true
        }
    }
    if (share) Object.defineProperty(navigator, 'share', { value: async data => { window.sharedData.push(data) }, configurable: true })
    else {
        delete Navigator.prototype.share
        Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
    }
}

const newReader = async (browser, options) => {
    const context = await browser.newContext(setup.context)
    await context.addInitScript(value => {
        localStorage.setItem('jellyfin_credentials', value)
        // The reading gestures hint was seen on this device before.
        localStorage.setItem('oriel-hints', JSON.stringify({ first: true, scroll: true }))
    }, credentials)
    await context.addInitScript(standIns, options)
    // The translation site is not visited: a tab opened there gets a blank page.
    await context.route('https://translate.google.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>translated</p>' }))
    const page = await context.newPage()
    await page.goto(`${base}/Oriel/?id=${itemId}`)
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 })
        .catch(() => fail('the reader did not render the book'))
    await pause(1500)
    if (!await page.locator('#controls header').isVisible()) await press(page, 0.5, setup.touch)
    await pause(600)
    await use(page.getByRole('button', { name: 'Contents' }))
    await pause(400)
    await use(page.locator('#contents').getByRole('link', { name: /^Chapter One/ }))
    await pause(1500)
    return { context, page }
}

// Selects `words` in the paragraph starting `paragraph` of the section shown, as a long press leaves it.
const select = async (page, paragraph, words) => {
    const found = await page.evaluate(({ paragraph, words }) => {
        const { doc } = document.querySelector('foliate-view').renderer.getContents()[0]
        const text = [...doc.querySelectorAll('p')].find(each => each.textContent.startsWith(paragraph))?.firstChild
        const at = text?.textContent.indexOf(words) ?? -1
        if (at < 0) return false
        const range = doc.createRange()
        range.setStart(text, at)
        range.setEnd(text, at + words.length)
        doc.getSelection().removeAllRanges()
        doc.getSelection().addRange(range)
        return true
    }, { paragraph, words })
    if (!found) fail(`'${words}' is not on the page`)
    await pause(800)
}

const selectedText = page => page.evaluate(() =>
    document.querySelector('foliate-view').renderer.getContents()[0].doc.getSelection().toString())

const toolbar = page => page.getByRole('toolbar', { name: 'Selected text' })
// The second row's buttons on screen, by name.
const row = page => toolbar(page).locator('.actions button').evaluateAll(items =>
    items.filter(item => !item.hidden).map(item => item.textContent.trim()))

const FIRST = ['Paragraph 1 holds', 'plain filler text']

// After an action: the toolbar closed, nothing selected, the controls not shown, still in Chapter One.
const afterAction = async (page, what) => {
    if (await toolbar(page).isVisible()) fail(`${what} left the toolbar open`)
    if (await selectedText(page)) fail(`${what} left the text selected`)
    if (await page.locator('#controls header').isVisible()) fail(`${what} showed the controls`)
    const section = await page.evaluate(() => document.querySelector('foliate-view').renderer.getContents()[0]?.index)
    if (section !== 0) fail(`${what} turned the page`)
}

const browser = await setup.engine.launch()
let failed = false
try {
    await clearHighlights()
    await setTranslateUrl(GOOGLE)
    let { context, page } = await newReader(browser, { share: true, secure: true })
    await page.keyboard.press('Escape')
    await pause(300)

    // The second row, in the canvas's order.
    await select(page, ...FIRST)
    let names = await row(page)
    if (names.join('|') !== 'Copy|Translate|Search|Share') fail(`for a selection the second row is ${names.join(', ')}`)
    for (const box of await toolbar(page).locator('.actions button:not([hidden])').evaluateAll(items => items.map(item => item.getBoundingClientRect()))) {
        if (box.height < 52 || box.width < 44) fail('an action button is under 52 px tall or 44 px wide')
    }
    pass(`selecting text shows ${names.join(', ')} below the highlighters`)

    // Copy.
    await use(toolbar(page).getByRole('button', { name: 'Copy' }))
    await pause(500)
    let copied = await page.evaluate(() => window.copiedText)
    if (copied.join() !== FIRST[1]) fail(`Copy put ${JSON.stringify(copied)} on the clipboard`)
    if ((await page.getByRole('status').filter({ hasText: 'Copied' }).count()) !== 1) fail('Copy did not say Copied')
    await afterAction(page, 'Copy')
    pass(`Copy puts '${FIRST[1]}' on the clipboard, says Copied, and closes the toolbar`)

    // Translate.
    await select(page, ...FIRST)
    const opened = context.waitForEvent('page', { timeout: 10_000 }).catch(() => null)
    await use(toolbar(page).getByRole('button', { name: 'Translate' }))
    const tab = await opened
    if (!tab) fail('Translate opened no tab')
    await tab.waitForLoadState().catch(() => {})
    const expected = GOOGLE.replace('{text}', encodeURIComponent(FIRST[1]))
    if (tab.url() !== expected) fail(`Translate opened ${tab.url()}, not ${expected}`)
    await tab.close()
    await afterAction(page, 'Translate')
    pass(`Translate opens ${expected} in a new tab`)

    // Share.
    await select(page, ...FIRST)
    await use(toolbar(page).getByRole('button', { name: 'Share' }))
    await pause(500)
    const shared = await page.evaluate(() => window.sharedData)
    if (JSON.stringify(shared) !== JSON.stringify([{ title: 'Oriel Smoke Book', text: FIRST[1] }])) fail(`Share sent ${JSON.stringify(shared)}`)
    await afterAction(page, 'Share')
    pass('Share hands the text and the book\'s title to the share sheet')

    // Search.
    await select(page, ...FIRST)
    await use(toolbar(page).getByRole('button', { name: 'Search' }))
    await pause(2500)
    const panel = page.locator('#search')
    if (!await panel.isVisible()) fail('Search did not open Search in this book')
    const query = await panel.getByRole('searchbox').inputValue()
    const found = await panel.locator('.results li').count()
    if (query !== FIRST[1] || found < 1) fail(`Search opened with '${query}' and ${found} matches`)
    if (await toolbar(page).isVisible() || await selectedText(page)) fail('Search left the toolbar open or the text selected')
    await page.keyboard.press('Escape')
    await pause(400)
    if (await page.locator('#controls header').isVisible()) fail('closing Search left the controls showing')
    pass(`Search opens Search in this book with '${query}' and its ${found} matches, and closing it leaves the controls hidden`)

    // A tapped highlight: the same actions, then Remove; Copy copies its text.
    await select(page, ...FIRST)
    await use(toolbar(page).getByRole('button', { name: 'Highlight: Quotes' }))
    await pause(1000)
    const line = await page.evaluate(([paragraph, words]) => {
        const { doc } = document.querySelector('foliate-view').renderer.getContents()[0]
        const frame = doc.defaultView.frameElement.getBoundingClientRect()
        const text = [...doc.querySelectorAll('p')].find(each => each.textContent.startsWith(paragraph)).firstChild
        const at = text.textContent.indexOf(words)
        const range = doc.createRange()
        range.setStart(text, at)
        range.setEnd(text, at + words.length)
        const box = range.getClientRects()[0]
        return { x: frame.left + (box.left + box.right) / 2, y: frame.top + (box.top + box.bottom) / 2 }
    }, FIRST)
    await pressPoint(page, line.x, line.y, setup.touch)
    await pause(600)
    names = await row(page)
    if (names.join('|') !== 'Copy|Translate|Search|Share|Remove') fail(`for a highlight the second row is ${names.join(', ')}`)
    await use(toolbar(page).getByRole('button', { name: 'Copy' }))
    await pause(500)
    copied = await page.evaluate(() => window.copiedText)
    if (copied.at(-1) !== FIRST[1]) fail(`Copy on a highlight put ${JSON.stringify(copied.at(-1))} on the clipboard`)
    await afterAction(page, 'Copy on a highlight')
    pass(`a tapped highlight shows ${names.join(', ')}, and Copy copies its text`)
    await context.close()

    // No share sheet, Translate off, and a page that is not secure: Copy the old way.
    await setTranslateUrl('')
    ;({ context, page } = await newReader(browser, { share: false, secure: false }))
    await page.keyboard.press('Escape')
    await pause(300)
    await select(page, ...FIRST)
    names = await row(page)
    if (names.join('|') !== 'Copy|Search') fail(`without a share sheet or a translation address the second row is ${names.join(', ')}`)
    await use(toolbar(page).getByRole('button', { name: 'Copy' }))
    await pause(500)
    copied = await page.evaluate(() => window.copiedText)
    if (copied.join() !== FIRST[1]) fail(`Copy on a page that is not secure put ${JSON.stringify(copied)} on the clipboard`)
    await afterAction(page, 'Copy the old way')
    pass('without a share sheet Share is gone, with the translation address empty Translate is gone, and Copy works where the clipboard API is not offered')
    await context.close()
} catch (error) {
    console.error(`FAIL: ${browserName}: ${error.message}`)
    failed = true
} finally {
    await setTranslateUrl(GOOGLE).catch(() => {})
    await clearHighlights().catch(() => {})
    // WebKit can hang while closing; the result is already known, so stop waiting.
    await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 10_000))])
}
process.exit(failed ? 1 : 0)
