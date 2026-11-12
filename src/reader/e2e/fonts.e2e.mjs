// Checks the reader's own fonts in the browser named by ORIEL_BROWSER: webkit
// at iPhone size with touch, or chromium at desktop size with a mouse. With
// EnableFontUploads off, Preferences offers the bundled fonts and a family
// already added but no Add font, the server answers 403 uploadsOff, and a
// family already added can still be removed. Once it is turned on through the
// configuration API, on the test EPUB, Add font after the font buttons opens Your fonts with its note;
// a regular TTF and an italic WOFF2 of one family make one row naming both
// styles and a font button with the upload icon; choosing it makes it the
// text's font, with its regular and italic files loaded from the plugin, and
// it survives a reload; another browser lists it. A file over 5 MB and a file
// that is not a font are refused with their messages, and the server refuses
// one over 5 MB too; a WOFF2 from Fontsource names its own family and style.
// Remove takes a family off the server, the list and the font buttons, and the
// text goes back to Default. Nothing is requested from another host.
// Configured by environment: ORIEL_BASE (server URL including any BaseUrl),
// ORIEL_SERVER_ID, ORIEL_USER_ID, ORIEL_TOKEN, ORIEL_ITEM_ID (the test EPUB)
// and ORIEL_BROWSER. Exits non-zero on the first failed check.
import { readFileSync } from 'node:fs'
import { chromium, devices, webkit } from 'playwright'
import { makeFont } from './make-font.mjs'
import { forgetChoices } from './choices.mjs'
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
const use = locator => setup.touch ? locator.tap() : locator.click()

// The test family, made from Atkinson Hyperlegible (SIL Open Font License) and renamed.
const FAMILY = 'Oriel Test Sans'
const fontsource = name => new URL(`../node_modules/@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-${name}`, import.meta.url)
const regular = { name: 'oriel-test-regular.ttf', mimeType: 'font/ttf', buffer: makeFont(fontsource('400-normal.woff'), FAMILY, 'ttf') }
const italic = { name: 'oriel-test-italic.woff2', mimeType: 'font/woff2', buffer: makeFont(fontsource('400-italic.woff'), FAMILY, 'woff2') }
const stock = { name: 'atkinson-bold.woff2', mimeType: 'font/woff2', buffer: readFileSync(fontsource('700-normal.woff2')) }
const big = { name: 'big.ttf', mimeType: 'font/ttf', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) }
const notes = { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('These are notes, not a font.') }

// The server's fonts for the user, and removing them, as the user.
const authorization = `MediaBrowser Client="oriel-e2e", Device="e2e", DeviceId="oriel-e2e-fonts", Version="1.0.0", Token="${token}"`
const stored = async () => {
    const response = await fetch(`${base}/Oriel/Fonts`, { headers: { Authorization: authorization } })
    if (!response.ok) fail(`GET /Oriel/Fonts returned ${response.status}`)
    return response.json()
}
const clear = async () => {
    for (const family of new Set((await stored()).map(font => font.family))) {
        await fetch(`${base}/Oriel/Fonts?family=${encodeURIComponent(family)}`, { method: 'DELETE', headers: { Authorization: authorization } })
    }
}
const addByApi = file => fetch(`${base}/Oriel/Fonts`, { method: 'POST', headers: { Authorization: authorization }, body: file.buffer })

// Turns font uploads on or off in Oriel's settings, as an admin does.
const PLUGIN_ID = '2c488ea7-0cae-4499-a2a7-6bae27b4e8f6'
const setFontUploads = async on => {
    const path = `${base}/Plugins/${PLUGIN_ID}/Configuration`
    const read = await fetch(path, { headers: { Authorization: authorization } })
    if (!read.ok) fail(`GET the plugin configuration returned ${read.status}`)
    const written = await fetch(path, {
        method: 'POST',
        headers: { Authorization: authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...await read.json(), EnableFontUploads: on }),
    })
    if (!written.ok) fail(`POST the plugin configuration returned ${written.status}`)
}

const newContext = async () => {
    const context = await browser.newContext(setup.context)
    await context.addInitScript(value => {
        localStorage.setItem('jellyfin_credentials', value)
        localStorage.setItem('oriel-hints', JSON.stringify({ first: true, scroll: true }))
    }, credentials)
    context.on('request', request => {
        const url = request.url()
        if (/^https?:/.test(url) && new URL(url).origin !== origin) elsewhere.push(url)
    })
    return context
}

const open = async context => {
    const page = await context.newPage()
    await page.goto(`${base}/Oriel/?id=${itemId}`)
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 })
        .catch(() => fail('the reader did not render the test EPUB'))
    await pause(1500)
    return page
}

const openPrefs = async page => {
    if (!await page.locator('#controls header').isVisible()) {
        if (!await pressAt(page, 0.5, setup.touch)) fail('no frame shows the page to tap')
        await pause(600)
    }
    await use(page.getByRole('button', { name: 'Preferences' }))
    await pause(400)
    const panel = page.locator('#prefs')
    if (!await panel.isVisible()) fail('Preferences did not open')
    return panel
}

const fontRow = panel => panel.getByRole('group', { name: 'Font' })
const fontNames = async panel => (await fontRow(panel).getByRole('button').allInnerTexts()).map(text => text.trim())
const ownRows = panel => panel.locator('.own-fonts li').evaluateAll(items => items.map(item => ({
    family: item.querySelector('.family')?.textContent ?? '',
    styles: item.querySelector('.styles')?.textContent ?? '',
})))
const message = async panel => (await panel.locator('.your-fonts .message').innerText()).trim()

// Waits for `check` to hold, up to `ms`.
const until = async (check, ms, what) => {
    const started = Date.now()
    while (!await check()) {
        if (Date.now() - started > ms) fail(what)
        await pause(250)
    }
}

// The computed font of the book's first paragraph, and the faces of the own family loaded in its frame.
const bookFont = page => page.evaluate(async family => {
    const doc = document.querySelector('foliate-view').renderer.getContents()[0].doc
    const css = `'Oriel own: ${family}'`
    await Promise.all([doc.fonts.load(`16px ${css}`), doc.fonts.load(`italic 16px ${css}`)]).catch(() => {})
    return {
        family: doc.defaultView.getComputedStyle(doc.querySelector('p')).fontFamily,
        faces: [...doc.fonts].filter(face => face.family.replace(/["']/g, '') === `Oriel own: ${family}`).map(face => `${face.style}:${face.status}`).sort(),
    }
}, FAMILY)

const elsewhere = []
const browser = await setup.engine.launch()
let failed = false
try {
    await forgetChoices(base, token)
    await clear()
    const context = await newContext()

    // With uploads off: the bundled fonts and the family already added, no Add font, and the server refuses another.
    await setFontUploads(true)
    if (!(await addByApi(regular)).ok) fail('the regular file could not be added with uploads on')
    await setFontUploads(false)
    const offPage = await open(context)
    const offPanel = await openPrefs(offPage)
    const offButtons = await fontNames(offPanel)
    if (offButtons.join('|') !== `Default|Literata|Noto Serif|Noto Sans|Atkinson Hyperlegible|${FAMILY}`) fail(`with uploads off the font buttons are ${offButtons.join(', ')}`)
    if (await offPanel.locator('.your-fonts').isVisible()) fail('with uploads off Your fonts shows')
    const refused = await addByApi(italic)
    const reason = (await refused.json().catch(() => null))?.reason
    if (refused.status !== 403 || reason !== 'uploadsOff') fail(`with uploads off the server answered ${refused.status} ${reason ?? ''}`)
    await clear()
    if ((await stored()).length) fail('with uploads off a family already added could not be removed')
    await offPage.close()
    pass(`with uploads off Preferences offers the bundled fonts and '${FAMILY}' without Add font, the server answers 403 uploadsOff, and the family can still be removed`)

    await setFontUploads(true)
    let page = await open(context)

    // Add font follows the font buttons and opens Your fonts.
    let panel = await openPrefs(page)
    const before = await fontNames(panel)
    if (before.join('|') !== 'Default|Literata|Noto Serif|Noto Sans|Atkinson Hyperlegible|Add font') fail(`the font buttons are ${before.join(', ')}`)
    await use(fontRow(panel).getByRole('button', { name: 'Add font' }))
    await pause(400)
    if ((await panel.locator('h2').innerText()).trim() !== 'Your fonts') fail('Add font did not open Your fonts')
    if (!await panel.getByRole('button', { name: 'Back' }).isVisible()) fail('Your fonts has no Back button')
    const note = (await panel.locator('.your-fonts .about').innerText()).trim()
    if (note !== 'Fonts you add are yours and appear on all your devices. TTF, OTF or WOFF2, up to 5 MB each. Only add fonts you are allowed to use.') fail(`Your fonts says '${note}'`)
    pass('Add font follows the font buttons and opens Your fonts with its note and Back')

    // A regular TTF and an italic WOFF2 of one family make one row naming both styles.
    const input = panel.locator('.your-fonts input[type="file"]')
    await input.setInputFiles(regular)
    await until(async () => (await ownRows(panel)).length === 1, 10_000, 'the regular file was not listed')
    await input.setInputFiles(italic)
    await until(async () => (await ownRows(panel))[0]?.styles === 'Regular, Italic', 10_000, `after the italic file Your fonts lists ${JSON.stringify(await ownRows(panel))}`)
    const kept = await stored()
    if (kept.map(font => `${font.family}/${font.style}/${font.format}`).join('|') !== `${FAMILY}/Regular/ttf|${FAMILY}/Italic/woff2`) fail(`the server keeps ${JSON.stringify(kept)}`)
    const rowFont = await panel.locator('.own-fonts .family').evaluate(node => getComputedStyle(node).fontFamily)
    if (!rowFont.includes(`Oriel own: ${FAMILY}`)) fail(`the row's name is set in ${rowFont}`)
    pass(`a TTF and a WOFF2 of '${FAMILY}' make one row, 'Regular, Italic', set in its own font, and the server keeps both`)

    // Back, then the family's own font button, with the upload icon.
    await use(panel.getByRole('button', { name: 'Back' }))
    await pause(300)
    if ((await panel.locator('h2').innerText()).trim() !== 'Preferences') fail('Back did not return to Preferences')
    const buttons = await fontNames(panel)
    if (buttons.join('|') !== `Default|Literata|Noto Serif|Noto Sans|Atkinson Hyperlegible|${FAMILY}|Add font`) fail(`the font buttons are ${buttons.join(', ')}`)
    const own = fontRow(panel).getByRole('button', { name: FAMILY })
    if (!await own.locator('svg').count()) fail('the family\'s button has no upload icon')
    const served = []
    page.on('response', response => { if (/\/Oriel\/Fonts\/[0-9a-f]{32}$/.test(response.url())) served.push(response.status()) })
    await use(own)
    await pause(1500)
    if (await own.getAttribute('aria-pressed') !== 'true') fail('the family is not marked as chosen')
    let shown = await bookFont(page)
    if (!shown.family.includes(`Oriel own: ${FAMILY}`) || shown.faces.join() !== 'italic:loaded,normal:loaded') fail(`after choosing it the text is set in ${shown.family}, faces ${shown.faces.join(', ')}`)
    pass(`choosing '${FAMILY}' sets the text in it, its regular and italic files loaded (${shown.faces.join(', ')})`)
    await page.keyboard.press('Escape')
    await pause(300)

    // Kept on this device, the files served by the plugin.
    await page.reload()
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 })
    await pause(1500)
    shown = await bookFont(page)
    if (!shown.family.includes(`Oriel own: ${FAMILY}`) || shown.faces.join() !== 'italic:loaded,normal:loaded') fail(`after a reload the text is set in ${shown.family}, faces ${shown.faces.join(', ')}`)
    if (served.length < 2 || served.some(status => status !== 200)) fail(`the plugin served the font files with ${served.join(', ') || 'nothing'}`)
    pass(`after a reload the text is still in '${FAMILY}', its files served by the plugin`)

    // Another browser lists the family.
    const other = await newContext()
    const second = await open(other)
    const theirs = await openPrefs(second)
    if (!(await fontNames(theirs)).includes(FAMILY)) fail(`another browser's font buttons are ${(await fontNames(theirs)).join(', ')}`)
    await other.close()
    pass(`another browser offers '${FAMILY}'`)

    // Refusals: over 5 MB, not a font; the server refuses over 5 MB too.
    panel = await openPrefs(page)
    await use(fontRow(panel).getByRole('button', { name: 'Add font' }))
    await pause(300)
    await panel.locator('.your-fonts input[type="file"]').setInputFiles(big)
    await until(async () => await message(panel) === 'big.ttf is larger than 5 MB.', 5000, `for a file over 5 MB Your fonts says '${await message(panel)}'`)
    await panel.locator('.your-fonts input[type="file"]').setInputFiles(notes)
    await until(async () => await message(panel) === 'notes.txt is not a TTF, OTF or WOFF2 font.', 10_000, `for a text file Your fonts says '${await message(panel)}'`)
    if ((await stored()).length !== 2) fail('a refused file was kept')
    const tooLarge = await fetch(`${base}/Oriel/Fonts`, { method: 'POST', headers: { Authorization: authorization }, body: big.buffer })
    if (tooLarge.status !== 413) fail(`the server answered ${tooLarge.status} to a file over 5 MB`)
    pass("a file over 5 MB and a text file are refused with 'big.ttf is larger than 5 MB.' and 'notes.txt is not a TTF, OTF or WOFF2 font.', and the server answers 413 over 5 MB")

    // A WOFF2 from Fontsource names its own family and style.
    await panel.locator('.your-fonts input[type="file"]').setInputFiles(stock)
    await until(async () => (await ownRows(panel)).some(row => row.family === 'Atkinson Hyperlegible'), 10_000, `after a Fontsource WOFF2 Your fonts lists ${JSON.stringify(await ownRows(panel))}`)
    const atkinson = (await ownRows(panel)).find(row => row.family === 'Atkinson Hyperlegible')
    if (atkinson.styles !== 'Bold') fail(`the Fontsource WOFF2 is listed as ${JSON.stringify(atkinson)}`)
    await use(panel.getByRole('button', { name: 'Remove Atkinson Hyperlegible' }))
    await until(async () => (await ownRows(panel)).length === 1, 5000, 'Remove did not take the Fontsource family off the list')
    pass("a WOFF2 from Fontsource is listed as 'Atkinson Hyperlegible', 'Bold', and Remove takes it off")

    // Removing the family chosen takes it off everywhere, and the text goes back to Default.
    await use(panel.getByRole('button', { name: `Remove ${FAMILY}` }))
    await until(async () => (await ownRows(panel)).length === 0, 5000, `Remove did not take '${FAMILY}' off the list`)
    if ((await stored()).length) fail('the server still keeps the removed family')
    await use(panel.getByRole('button', { name: 'Back' }))
    await pause(1000)
    const after = await fontNames(panel)
    if (after.includes(FAMILY)) fail(`after Remove the font buttons are ${after.join(', ')}`)
    if (await fontRow(panel).getByRole('button', { name: 'Default' }).getAttribute('aria-pressed') !== 'true') fail('after removing the family chosen, Default is not chosen')
    shown = await bookFont(page)
    if (shown.family.includes('Oriel own')) fail(`after Remove the text is still set in ${shown.family}`)
    pass(`Remove takes '${FAMILY}' off the server, the list and the font buttons, and the text goes back to Default`)
    await page.close()

    if (elsewhere.length) fail(`requests went to other hosts: ${[...new Set(elsewhere)].join(', ')}`)
    pass(`no request went to any host but ${origin}`)
} catch (error) {
    console.error(`FAIL: ${browserName}: ${error.message}`)
    failed = true
} finally {
    await forgetChoices(base, token).catch(() => {})
    await clear().catch(() => {})
    await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 10_000))])
}
process.exit(failed ? 1 : 0)
