// Checks Preferences in the browser named by ORIEL_BROWSER: webkit at iPhone
// size with touch, or chromium at desktop size with a mouse. With the controls
// shown, Preferences sits in the header between Contents and More. It opens a
// panel titled Preferences; Escape, Close and (on a phone) the dimmed page
// close it and leave the book where it is. Sepia and then Dark colour the
// book's text and page and the reading footer at once. Literata becomes the
// text's font, its file served by the plugin, and nothing is requested from
// another host. More size makes the text 1 px larger and keeps the chapter on
// screen. Line spacing, paragraph spacing, indent, the margins and the Justify
// and Hyphenate checkboxes change the text's layout at once, each keeping the
// chapter; Use the book's layout and fonts drops Oriel's font and spacing and
// disables their controls until it is turned off. After a reload the book
// opens in Dark, Literata, one size up, with the layout chosen. Reset asks
// first: Cancel and Escape change nothing, and Reset brings size, spacing,
// margins and checkboxes back to the defaults, keeping theme, font and
// chapter. On the test comic and PDF the theme colours the page and the
// font, size, spacing, margin and checkbox controls are disabled. Configured by environment: ORIEL_BASE (server URL including
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

// The layout of a body paragraph (the third, so it is indented) in the section
// frame shown; where the text starts on the page (the leftmost line shown); and
// the top of the reading area.
const bookLayout = page => page.evaluate(() => {
    const view = document.querySelector('foliate-view')
    const { doc } = view.renderer.getContents()[0] ?? {}
    const paragraph = doc?.querySelectorAll('p')[2]
    if (!paragraph) return null
    const style = doc.defaultView.getComputedStyle(paragraph)
    const frame = doc.defaultView.frameElement.getBoundingClientRect()
    let left = Infinity
    for (const line of [...doc.querySelectorAll('p')].flatMap(p => [...p.getClientRects()])) {
        const x = frame.left + line.left
        if (line.width > 0 && x >= 0 && x < innerWidth) left = Math.min(left, x)
    }
    const area = view.getBoundingClientRect()
    return {
        size: parseFloat(style.fontSize),
        line: style.lineHeight,
        gap: parseFloat(style.marginBottom),
        indent: parseFloat(style.textIndent),
        align: style.textAlign,
        hyphens: style.hyphens || style.webkitHyphens,
        font: style.fontFamily,
        left: Math.round(left * 10) / 10,
        top: area.top,
    }
})

const near = (value, want) => Math.abs(parseFloat(value) - want) < 0.06
// Pixel positions, which can fall between pixels.
const close = (value, want) => Math.abs(value - want) < 0.6

// The layout defaults: spacing, then margins for this screen.
const SPACING = { line: 1.5, paragraph: 0, indent: 1.4 }
const MARGINS = setup.touch ? { left: 24, right: 24, top: 16, bottom: 8 } : { left: 140, right: 140, top: 48, bottom: 12 }

const value = (panel, setting) => panel.locator(`[data-setting="${setting}"] .value`).innerText().then(text => text.trim())

const step = async (panel, label) => {
    const button = panel.getByRole('button', { name: label, exact: true })
    if (!await button.isVisible()) fail(`Preferences has no ${label} button`)
    await button.click()
    await pause(900)
}

const check = async (panel, name, on) => {
    const box = panel.getByRole('checkbox', { name, exact: true })
    if (!await box.isVisible()) fail(`Preferences has no ${name} checkbox`)
    if (await box.isChecked() !== on) await box.click()
    await pause(900)
}

// The chapter in the reading footer, read with the controls shown or not.
const chapterShown = page => page.locator('#reading-footer .chapter').innerText().then(text => text.trim())

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
    if ((await panel.locator('.value').first().innerText()).trim() !== '19') fail('the size shown is not 19')
    const chapterAfter = (await page.locator('#reading-footer .chapter').innerText()).trim()
    if (!chapter || chapter === 'Chapter One') fail(`the book did not move to the middle: it shows '${chapter}'`)
    if (chapterAfter !== chapter) fail(`More size moved the book from ${chapter} to ${chapterAfter}`)
    pass(`More size makes the text 19 px and keeps ${chapter || 'the place'} on screen`)

    // The layout controls and their defaults.
    if (!await panel.getByRole('button', { name: 'More line spacing', exact: true }).isVisible()) fail('Preferences has no Line spacing stepper')
    const shownValues = [await value(panel, 'lineSpacing'), await value(panel, 'paragraphSpacing'), await value(panel, 'indent')]
    if (shownValues.join(' | ') !== '1.5 | 0.0 em | 1.4 em') fail(`the spacing shown is ${shownValues.join(' | ')}, expected 1.5 | 0.0 em | 1.4 em`)
    for (const side of ['left', 'right', 'top', 'bottom']) {
        const shown = await value(panel, `margin-${side}`)
        if (shown !== String(MARGINS[side])) fail(`the ${side} margin shown is ${shown}, expected ${MARGINS[side]}`)
    }
    for (const [name, on] of [['Justify text', true], ['Hyphenate words', true], ["Use the book's layout and fonts", false]]) {
        const box = panel.getByRole('checkbox', { name, exact: true })
        if (!await box.isVisible()) fail(`Preferences has no ${name} checkbox`)
        if (await box.isChecked() !== on) fail(`${name} starts ${on ? 'off' : 'on'}`)
    }
    let layout = await bookLayout(page)
    if (!near(layout.line, 1.5 * 19) || layout.gap !== 0 || !near(layout.indent, 1.4 * 19) || layout.align !== 'justify' || layout.hyphens !== 'auto') {
        fail(`by default a paragraph has line-height ${layout.line}, margin ${layout.gap}, indent ${layout.indent}, ${layout.align}, hyphens ${layout.hyphens}`)
    }
    if (setup.touch && (!close(layout.left, MARGINS.left) || !close(layout.top, MARGINS.top))) fail(`the text starts at ${layout.left}, the reading area at ${layout.top}, expected ${MARGINS.left}, ${MARGINS.top}`)
    pass(`the layout starts at the defaults: line 1.5, paragraph 0, indent 1.4 em, justified, hyphenated, margins ${Object.values(MARGINS).join('/')}`)

    // Each change applies at once and keeps the chapter.
    const changes = [
        ['More line spacing', l => near(l.line, 1.6 * 19), 'line-height 1.6'],
        ['More paragraph spacing', l => near(l.gap, 0.1 * 19), 'paragraph spacing 0.1 em'],
        ['More indent', l => near(l.indent, 1.5 * 19), 'indent 1.5 em'],
    ]
    for (const [label, ok, what] of changes) {
        await step(panel, label)
        layout = await bookLayout(page)
        if (!ok(layout)) fail(`${label} gave ${JSON.stringify(layout)}, expected ${what}`)
        if (await chapterShown(page) !== chapter) fail(`${label} moved the book from ${chapter} to ${await chapterShown(page)}`)
    }
    const before4 = await bookLayout(page)
    await step(panel, 'More left margin')
    await step(panel, 'More top margin')
    layout = await bookLayout(page)
    if (!close(layout.left, before4.left + 4) || !close(layout.top, before4.top + 4)) fail(`More left and top margin moved the reading area from ${before4.left}, ${before4.top} to ${layout.left}, ${layout.top}`)
    if (await value(panel, 'margin-left') !== String(MARGINS.left + 4)) fail('the left margin shown did not go up by 4')
    if (await chapterShown(page) !== chapter) fail(`the margins moved the book from ${chapter} to ${await chapterShown(page)}`)
    await check(panel, 'Justify text', false)
    await check(panel, 'Hyphenate words', false)
    layout = await bookLayout(page)
    if (layout.align === 'justify' || layout.hyphens !== 'manual') fail(`with Justify and Hyphenate off a paragraph is ${layout.align}, hyphens ${layout.hyphens}`)
    if (await chapterShown(page) !== chapter) fail(`the checkboxes moved the book from ${chapter} to ${await chapterShown(page)}`)
    pass(`line spacing, paragraph spacing, indent, margins, Justify and Hyphenate apply at once and keep ${chapter} on screen`)

    // The book's own layout: Oriel's font and spacing go, their controls are disabled; size stays.
    await check(panel, "Use the book's layout and fonts", true)
    layout = await bookLayout(page)
    if (layout.font.startsWith('Literata') || near(layout.line, 1.6 * 19) || layout.indent !== 0) fail(`with the book's layout the text is ${layout.font}, line-height ${layout.line}, indent ${layout.indent}`)
    if (layout.size !== 19) fail(`with the book's layout the size is ${layout.size}, expected 19`)
    for (const label of ['Literata', 'More line spacing', 'Less paragraph spacing', 'More indent']) {
        if (await panel.getByRole('button', { name: label, exact: true }).isEnabled()) fail(`${label} is enabled with the book's layout`)
    }
    for (const name of ['Justify text', 'Hyphenate words']) {
        if (await panel.getByRole('checkbox', { name, exact: true }).isEnabled()) fail(`${name} is enabled with the book's layout`)
    }
    if (!await panel.getByRole('button', { name: 'More left margin', exact: true }).isEnabled()) fail('the margins are disabled with the book\'s layout')
    await check(panel, "Use the book's layout and fonts", false)
    layout = await bookLayout(page)
    if (!layout.font.startsWith('Literata') || !near(layout.line, 1.6 * 19)) fail(`turning the book's layout off left ${layout.font}, line-height ${layout.line}`)
    if (await chapterShown(page) !== chapter) fail(`the book's layout moved the book from ${chapter} to ${await chapterShown(page)}`)
    pass("Use the book's layout and fonts drops Oriel's font and spacing, disables their controls and keeps the size; off brings them back")
    const chosen = await bookLayout(page)

    // Kept on this device.
    await page.reload()
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 })
    await pause(1500)
    await checkTheme(page, 'Dark')
    text = await bookText(page)
    if (!text.font.startsWith('Literata') || text.size !== 19) fail(`after a reload the text is ${text.font} at ${text.size} px`)
    layout = await bookLayout(page)
    if (!close(layout.left, chosen.left) || !close(layout.top, chosen.top)) fail(`after a reload the text starts at ${layout.left}, ${layout.top}, expected ${chosen.left}, ${chosen.top}`)
    for (const key of ['line', 'gap', 'indent', 'align', 'hyphens']) {
        if (String(layout[key]) !== String(chosen[key])) fail(`after a reload the ${key} is ${layout[key]}, expected ${chosen[key]}`)
    }
    pass('after a reload the book opens in Dark, Literata, 19 px, with the spacing, margins and checkboxes chosen')

    // Reset asks first; Cancel and Escape change nothing; Reset keeps theme, font and place.
    const resetChapter = await chapterShown(page)
    panel = await openPrefs(page)
    const dialog = page.getByRole('alertdialog')
    const openReset = async () => {
        const button = panel.getByRole('button', { name: 'Reset to defaults', exact: true })
        if (!await button.isVisible()) {
            await button.scrollIntoViewIfNeeded().catch(() => fail('Preferences has no Reset to defaults button'))
        }
        await button.click()
        await pause(300)
        if (!await dialog.isVisible()) fail('Reset to defaults did not ask first')
    }
    await openReset()
    const heading = (await dialog.locator('h2').innerText()).trim()
    if (heading !== 'Reset layout to the defaults?') fail(`the reset dialog is titled '${heading}'`)
    const body = (await dialog.locator('p').innerText()).trim()
    const device = setup.touch ? 'phone' : 'computer'
    if (body !== `Size, spacing, margins and page turn on this ${device} go back to the defaults. Your theme and font stay as they are.`) fail(`the reset dialog says '${body}'`)
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await pause(300)
    if (await dialog.isVisible()) fail('Cancel did not close the reset dialog')
    await openReset()
    await page.keyboard.press('Escape')
    await pause(300)
    if (await dialog.isVisible()) fail('Escape did not close the reset dialog')
    if (!await panel.isVisible()) fail('Escape in the reset dialog also closed Preferences')
    layout = await bookLayout(page)
    if (layout.line !== chosen.line || !close(layout.left, chosen.left)) fail('Cancel or Escape changed the layout')
    await openReset()
    await dialog.getByRole('button', { name: 'Reset', exact: true }).click()
    await pause(1500)
    if (await dialog.isVisible()) fail('Reset did not close the dialog')
    layout = await bookLayout(page)
    if (layout.size !== 18 || !near(layout.line, SPACING.line * 18) || layout.gap !== 0 || !near(layout.indent, SPACING.indent * 18) || layout.align !== 'justify' || layout.hyphens !== 'auto') {
        fail(`after Reset a paragraph is ${JSON.stringify(layout)}`)
    }
    if (!close(layout.left, chosen.left - 4) || !close(layout.top, chosen.top - 4)) fail(`after Reset the reading area starts at ${layout.left}, ${layout.top}, expected ${chosen.left - 4}, ${chosen.top - 4}`)
    if (await panel.getByRole('checkbox', { name: "Use the book's layout and fonts", exact: true }).isChecked()) fail("after Reset the book's layout is on")
    await checkTheme(page, 'Dark')
    if (!layout.font.startsWith('Literata')) fail(`after Reset the font is ${layout.font}, expected Literata`)
    if (await chapterShown(page) !== resetChapter) fail(`Reset moved the book from ${resetChapter} to ${await chapterShown(page)}`)
    pass(`Reset asks first, Cancel and Escape change nothing, and Reset restores size, spacing, margins and checkboxes, keeping Dark, Literata and ${resetChapter}`)
    await page.close()

    // Comics and PDFs: the theme colours the page; font and size are disabled.
    for (const [name, id] of [['comic', comicId], ['PDF', pdfId]]) {
        const fixed = await open(context, id)
        if (await pageColour(fixed) !== THEMES.Dark.page) fail(`the page around the ${name} is ${await pageColour(fixed)}, expected Dark`)
        const prefs = await openPrefs(fixed)
        for (const label of ['Literata', 'Less size', 'More size', 'More line spacing', 'More paragraph spacing', 'More indent', 'More left margin', 'Less bottom margin']) {
            if (await prefs.getByRole('button', { name: label, exact: true }).isEnabled()) fail(`${label} is enabled for the ${name}`)
        }
        for (const label of ['Justify text', 'Hyphenate words', "Use the book's layout and fonts"]) {
            if (await prefs.getByRole('checkbox', { name: label, exact: true }).isEnabled()) fail(`${label} is enabled for the ${name}`)
        }
        pass(`on the ${name} the page is Dark and the font, size, spacing, margin and checkbox controls are disabled`)
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
