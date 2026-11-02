// Checks Define and the Dictionary sheet in the browser named by ORIEL_BROWSER:
// webkit at iPhone size with touch, or chromium at desktop size with a mouse.
// On the test EPUB, selecting a word shows Define after Copy; Define opens the
// Dictionary sheet with the word in the book's serif at 26 px, its part of
// speech in italics and its senses numbered, and where they come from; Copy
// there copies the word and Search in this book searches for it. An inflected
// word ('holds') is found by its base form, a phrase ('at a time') whole, and a
// word the dictionary does not hold ('the') says so. More than three words show
// no Define, and a tapped highlight of three words shows it. No request leaves
// the server. The clipboard is stood in for in the page.
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

const authorization = `MediaBrowser Client="oriel-e2e", Device="e2e", DeviceId="oriel-e2e-define", Version="1.0.0", Token="${token}"`
const call = async (path, init = {}) => {
    const response = await fetch(`${base}${path}`, { ...init, headers: { Authorization: authorization, 'Content-Type': 'application/json', ...init.headers } })
    if (!response.ok) fail(`${init.method ?? 'GET'} ${path} returned ${response.status}`)
    return response.status === 204 ? null : response.json()
}
const clearHighlights = async () => {
    for (const highlight of await call(`/Oriel/Highlights/${itemId}`)) await call(`/Oriel/Highlights/${itemId}/${highlight.id}`, { method: 'DELETE' })
}

// Stands in for the clipboard: what is copied is kept on the page.
const standIns = () => {
    window.copiedText = []
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.copiedText.push(text) } }, configurable: true })
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

const toolbar = page => page.getByRole('toolbar', { name: 'Selected text' })
// The second row's buttons on screen, by name.
const row = page => toolbar(page).locator('.actions button').evaluateAll(items =>
    items.filter(item => !item.hidden).map(item => item.textContent.trim()))
const sheet = page => page.locator('#dictionary')

// What the Dictionary sheet shows: the word with its size and font, each part
// of speech with its style and its senses, the status line and the source line.
const shown = page => sheet(page).evaluate(element => {
    const word = element.querySelector('.word')
    const style = getComputedStyle(word)
    return {
        word: word.textContent,
        size: style.fontSize,
        font: style.fontFamily,
        parts: [...element.querySelectorAll('.entries section')].map(part => ({
            name: part.querySelector('.part').textContent,
            italic: getComputedStyle(part.querySelector('.part')).fontStyle === 'italic',
            numbered: getComputedStyle(part.querySelector('ol')).listStyleType === 'decimal',
            senses: part.querySelectorAll('li').length,
        })),
        status: element.querySelector('.status').textContent,
        source: element.querySelector('.source').textContent,
    }
})

// Selects `words` and opens the Dictionary sheet with Define.
const define = async (page, paragraph, words) => {
    await select(page, paragraph, words)
    const names = await row(page)
    if (names[1] !== 'Define') fail(`for '${words}' the second row is ${names.join(', ')}, without Define after Copy`)
    await use(toolbar(page).getByRole('button', { name: 'Define' }))
    await pause(800)
    if (!await sheet(page).isVisible()) fail(`Define on '${words}' did not open the Dictionary sheet`)
    return shown(page)
}
const closeSheet = async page => {
    await page.keyboard.press('Escape')
    await pause(300)
    if (await sheet(page).isVisible()) fail('Escape did not close the Dictionary sheet')
}

const FIRST = 'Paragraph 1 holds'
const MORE = 'More filler follows'

const browser = await setup.engine.launch()
let failed = false
try {
    await clearHighlights()
    const context = await browser.newContext(setup.context)
    await context.addInitScript(value => {
        localStorage.setItem('jellyfin_credentials', value)
        // The reading gestures hint was seen on this device before.
        localStorage.setItem('oriel-hints', JSON.stringify({ first: true, scroll: true }))
    }, credentials)
    await context.addInitScript(standIns)
    // Every request the page makes over the network, to see none leaves the server.
    const elsewhere = []
    context.on('request', request => {
        const url = new URL(request.url())
        if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== origin) elsewhere.push(request.url())
    })
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
    await page.keyboard.press('Escape')
    await pause(300)

    // A word: the sheet as the canvas draws it.
    let seen = await define(page, FIRST, 'filler')
    if (seen.word !== 'filler' || seen.size !== '26px' || !/Literata/.test(seen.font)) fail(`the sheet shows ${JSON.stringify(seen.word)} at ${seen.size} in ${seen.font}`)
    if (seen.parts.length !== 1 || seen.parts[0].name !== 'noun' || !seen.parts[0].italic || !seen.parts[0].numbered || seen.parts[0].senses !== 5) fail(`the sheet shows ${JSON.stringify(seen.parts)}`)
    if (seen.source !== 'From the English dictionary on your server · works offline' || seen.status) fail(`the sheet says '${seen.status}' and '${seen.source}'`)
    pass('Define after Copy opens the Dictionary sheet: filler at 26 px in Literata, noun in italics with its 5 senses numbered, from the dictionary on the server')

    // Copy and Search in this book act on the word.
    await use(sheet(page).getByRole('button', { name: 'Copy' }))
    await pause(500)
    const copied = await page.evaluate(() => window.copiedText)
    if (copied.join() !== 'filler') fail(`Copy on the sheet put ${JSON.stringify(copied)} on the clipboard`)
    if ((await page.getByRole('status').filter({ hasText: 'Copied' }).count()) !== 1) fail('Copy on the sheet did not say Copied')
    await use(sheet(page).getByRole('button', { name: 'Search in this book' }))
    await pause(2500)
    if (await sheet(page).isVisible()) fail('Search in this book left the Dictionary sheet open')
    const panel = page.locator('#search')
    const query = await panel.getByRole('searchbox').inputValue().catch(() => '')
    const found = await panel.locator('.results li').count()
    if (!await panel.isVisible() || query !== 'filler' || found < 1) fail(`Search in this book opened with '${query}' and ${found} matches`)
    await page.keyboard.press('Escape')
    await pause(400)
    pass(`Copy on the sheet copies 'filler', and Search in this book finds its ${found} matches`)

    // An inflected word by its base form, a phrase whole, a word not held.
    seen = await define(page, FIRST, 'holds')
    if (seen.word !== 'hold' || seen.parts.map(part => part.name).join() !== 'noun,verb') fail(`'holds' shows ${seen.word} as ${seen.parts.map(part => part.name)}`)
    await closeSheet(page)
    seen = await define(page, MORE, 'at a time')
    if (seen.word !== 'at a time' || seen.parts.map(part => part.name).join() !== 'adverb') fail(`'at a time' shows ${seen.word} as ${seen.parts.map(part => part.name)}`)
    await closeSheet(page)
    seen = await define(page, FIRST, 'the')
    if (seen.status !== 'No definition for the in the dictionary on your server.' || seen.parts.length) fail(`'the' shows '${seen.status}' and ${seen.parts.length} parts of speech`)
    await closeSheet(page)
    pass("'holds' shows hold as noun and verb, 'at a time' as an adverb, and 'the' says there is no definition on the server")

    // More than three words: no Define; a tapped highlight of three: Define.
    await select(page, FIRST, 'holds plain filler text')
    let names = await row(page)
    if (names.includes('Define')) fail('four words show Define')
    await page.keyboard.press('Escape')
    await pause(300)
    await select(page, FIRST, 'plain filler text')
    await use(toolbar(page).getByRole('button', { name: 'Highlight: Quotes' }))
    await pause(1000)
    const line = await page.evaluate(paragraph => {
        const { doc } = document.querySelector('foliate-view').renderer.getContents()[0]
        const frame = doc.defaultView.frameElement.getBoundingClientRect()
        const text = [...doc.querySelectorAll('p')].find(each => each.textContent.startsWith(paragraph)).firstChild
        const at = text.textContent.indexOf('plain filler text')
        const range = doc.createRange()
        range.setStart(text, at)
        range.setEnd(text, at + 'plain filler text'.length)
        const box = range.getClientRects()[0]
        return { x: frame.left + (box.left + box.right) / 2, y: frame.top + (box.top + box.bottom) / 2 }
    }, FIRST)
    await pressPoint(page, line.x, line.y, setup.touch)
    await pause(600)
    names = await row(page)
    if (names[1] !== 'Define' || names.at(-1) !== 'Remove') fail(`for a tapped highlight the second row is ${names.join(', ')}`)
    pass('four selected words show no Define, and a tapped highlight of three words shows it')

    if (elsewhere.length) fail(`the page asked another host for ${elsewhere.join(', ')}`)
    pass(`no request went to a host other than ${origin}`)
    await context.close()
} catch (error) {
    console.error(`FAIL: ${browserName}: ${error.message}`)
    failed = true
} finally {
    await clearHighlights().catch(() => {})
    // WebKit can hang while closing; the result is already known, so stop waiting.
    await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 10_000))])
}
process.exit(failed ? 1 : 0)
