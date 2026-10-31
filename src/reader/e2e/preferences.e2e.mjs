// Checks Preferences in the browser named by ORIEL_BROWSER: webkit at iPhone
// size with touch, or chromium at desktop size with a mouse. With the controls
// shown, Preferences sits in the header between Contents and More. It opens a
// panel titled Preferences; Escape, Close and (on a phone) the dimmed page
// close it and leave the book where it is. Sepia and then Dark colour the
// book's text and page and the reading footer at once. Literata becomes the
// text's font, its file served by the plugin, and nothing is requested from
// another host. More size makes the text 1 px larger and keeps the chapter on
// screen. After a reload the book opens in Dark, Literata, one size up. On the
// test comic and PDF the theme colours the page and the font and size buttons
// are disabled. Configured by environment: ORIEL_BASE (server URL including
// any BaseUrl), ORIEL_SERVER_ID, ORIEL_USER_ID, ORIEL_TOKEN, ORIEL_ITEM_ID (the
// test EPUB), ORIEL_CBZ_ID (the test comic), ORIEL_PDF_ID (the test PDF) and
// ORIEL_BROWSER. Exits non-zero on the first failed check.
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
const comicId = env('ORIEL_CBZ_ID')
const pdfId = env('ORIEL_PDF_ID')
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

// The themes' colours as the browser reports them: text, page, reading footer.
const THEMES = {
    Light: { text: 'rgb(27, 27, 27)', page: 'rgb(255, 255, 255)', footer: 'rgb(107, 107, 107)' },
    Sepia: { text: 'rgb(59, 47, 34)', page: 'rgb(244, 236, 216)', footer: 'rgb(110, 90, 62)' },
    Dark: { text: 'rgb(214, 214, 214)', page: 'rgb(16, 16, 16)', footer: 'rgb(154, 154, 154)' },
}

const press = async (page, share) => {
    if (!await pressAt(page, share, setup.touch)) fail('no frame shows the page to tap')
    await pause(600)
}

// The page shown, as "<section index>:<page>".
const position = page => page.evaluate(() => {
    const renderer = document.querySelector('foliate-view').renderer
    return `${renderer.getContents()[0]?.index}:${renderer.page}`
})

// The text's colour, background, font and size in the section frame shown.
const bookText = page => page.evaluate(() => {
    const { doc } = document.querySelector('foliate-view').renderer.getContents()[0] ?? {}
    const paragraph = doc?.querySelector('p')
    if (!paragraph) return null
    const style = doc.defaultView.getComputedStyle(paragraph)
    return {
        text: style.color,
        page: doc.defaultView.getComputedStyle(doc.body).backgroundColor,
        font: style.fontFamily,
        size: parseFloat(style.fontSize),
        literata: doc.fonts.check('16px Literata'),
    }
})

const footerColour = page => page.locator('#reading-footer').evaluate(footer => getComputedStyle(footer).color)
const pageColour = page => page.evaluate(() => getComputedStyle(document.body).backgroundColor)

const open = async (context, id) => {
    const page = await context.newPage()
    await page.goto(`${base}/Oriel/?id=${id}`)
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 })
        .catch(() => fail(`the reader did not render ${id}`))
    await pause(1000)
    return page
}

// Shows the controls and opens Preferences.
const openPrefs = async page => {
    if (!await page.locator('#controls header').isVisible()) await press(page, 0.5)
    const button = page.getByRole('button', { name: 'Preferences' })
    if (!await button.isVisible()) fail('the controls have no Preferences button')
    await button.click()
    await pause(400)
    const panel = page.locator('#prefs')
    if (!await panel.isVisible()) fail('Preferences did not open')
    return panel
}

const closePrefs = async page => {
    await page.keyboard.press('Escape')
    await pause(300)
}

const choose = async (panel, name) => {
    const button = panel.getByRole('button', { name, exact: true })
    await button.click()
    await pause(800)
    if (await button.getAttribute('aria-pressed') !== 'true') fail(`${name} is not marked as chosen`)
}

const checkTheme = async (page, name) => {
    const want = THEMES[name]
    const text = await bookText(page)
    if (!text) fail('no text in the book frame')
    if (text.text !== want.text || text.page !== want.page) fail(`with ${name} the book's text is ${text.text} on ${text.page}, expected ${want.text} on ${want.page}`)
    const footer = await footerColour(page)
    if (footer !== want.footer) fail(`with ${name} the reading footer is ${footer}, expected ${want.footer}`)
}

const browser = await setup.engine.launch()
let failed = false
try {
    const context = await browser.newContext(setup.context)
    await context.addInitScript(value => {
        localStorage.setItem('jellyfin_credentials', value)
    }, credentials)
    // Every request the reader makes, to show nothing goes to another host.
    const elsewhere = []
    const fonts = []
    context.on('request', request => {
        const url = request.url()
        if (/^https?:/.test(url) && new URL(url).origin !== origin) elsewhere.push(url)
        if (url.endsWith('.woff2')) fonts.push(url)
    })
    const page = await open(context, itemId)

    // The button sits in the header, between Contents and More.
    await press(page, 0.5)
    const order = await page.locator('#controls header button').evaluateAll(buttons => buttons.map(b => b.getAttribute('aria-label')))
    if (order.join(', ') !== 'Contents, Preferences, More') fail(`the header's buttons are ${order.join(', ')}`)
    const size = await page.getByRole('button', { name: 'Preferences' }).boundingBox()
    if (!size || size.width < 44 || size.height < 44) fail('the Preferences button is under 44 px')
    pass(`the header's buttons are ${order.join(', ')}`)

    // The panel, and the ways to close it without moving the book.
    const before = await position(page)
    let panel = await openPrefs(page)
    const title = (await panel.locator('h2').innerText()).trim()
    if (title !== 'Preferences') fail(`the panel is titled '${title}'`)
    await checkTheme(page, 'Light')
    await closePrefs(page)
    if (await panel.isVisible()) fail('Escape did not close Preferences')
    panel = await openPrefs(page)
    await panel.getByRole('button', { name: 'Close' }).click()
    await pause(300)
    if (await panel.isVisible()) fail('Close did not close Preferences')
    if (setup.touch) {
        panel = await openPrefs(page)
        await page.locator('#prefs-backdrop').click({ position: { x: 20, y: 60 } })
        await pause(300)
        if (await panel.isVisible()) fail('a tap on the dimmed page did not close Preferences')
    }
    if (await position(page) !== before) fail('closing Preferences moved the book')
    pass(`Preferences opens in Light; Escape, Close${setup.touch ? ' and the dimmed page' : ''} close it and leave the book at ${before}`)

    // Themes apply at once.
    panel = await openPrefs(page)
    await choose(panel, 'Sepia')
    await checkTheme(page, 'Sepia')
    await choose(panel, 'Dark')
    await checkTheme(page, 'Dark')
    if (await pageColour(page) !== THEMES.Dark.page) fail(`with Dark the page around the book is ${await pageColour(page)}`)
    pass('Sepia and then Dark colour the text, the page and the reading footer at once')

    // A bundled font, served by the plugin.
    await choose(panel, 'Literata')
    await pause(700)
    let text = await bookText(page)
    if (!text.font.startsWith('Literata')) fail(`with Literata the text's font is ${text.font}`)
    if (!text.literata) fail('Literata did not load in the book frame')
    if (!fonts.some(url => url.startsWith(origin) && /literata-latin-400-normal/.test(url))) fail(`Literata's file was not loaded from the plugin: ${fonts.join(', ') || 'no font requests'}`)
    pass(`Literata becomes the text's font, loaded from ${origin}`)

    // The size steps by 1 and keeps the chapter, from the middle of the book,
    // where a lost place would show.
    await page.evaluate(() => document.querySelector('foliate-view').goToFraction(0.6))
    await pause(1200)
    const chapter = (await page.locator('#reading-footer .chapter').innerText()).trim()
    const sizeBefore = text.size
    if (sizeBefore !== 18) fail(`the text starts at ${sizeBefore} px, expected 18`)
    await panel.getByRole('button', { name: 'More size' }).click()
    await pause(1200)
    text = await bookText(page)
    if (text.size !== 19) fail(`More size made the text ${text.size} px, expected 19`)
    if ((await panel.locator('.value').innerText()).trim() !== '19') fail('the size shown is not 19')
    const chapterAfter = (await page.locator('#reading-footer .chapter').innerText()).trim()
    if (!chapter || chapter === 'Chapter One') fail(`the book did not move to the middle: it shows '${chapter}'`)
    if (chapterAfter !== chapter) fail(`More size moved the book from ${chapter} to ${chapterAfter}`)
    pass(`More size makes the text 19 px and keeps ${chapter || 'the place'} on screen`)

    // Kept on this device.
    await page.reload()
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 })
    await pause(1500)
    await checkTheme(page, 'Dark')
    text = await bookText(page)
    if (!text.font.startsWith('Literata') || text.size !== 19) fail(`after a reload the text is ${text.font} at ${text.size} px`)
    pass('after a reload the book opens in Dark, Literata, 19 px')
    await page.close()

    // Comics and PDFs: the theme colours the page; font and size are disabled.
    for (const [name, id] of [['comic', comicId], ['PDF', pdfId]]) {
        const fixed = await open(context, id)
        if (await pageColour(fixed) !== THEMES.Dark.page) fail(`the page around the ${name} is ${await pageColour(fixed)}, expected Dark`)
        const prefs = await openPrefs(fixed)
        for (const label of ['Literata', 'Less size', 'More size']) {
            if (await prefs.getByRole('button', { name: label, exact: true }).isEnabled()) fail(`${label} is enabled for the ${name}`)
        }
        pass(`on the ${name} the page is Dark and the font and size buttons are disabled`)
        await fixed.close()
    }

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
