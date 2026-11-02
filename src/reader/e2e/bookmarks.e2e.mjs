// Checks bookmarks in the browser named by ORIEL_BROWSER: webkit at iPhone size
// with touch, or chromium at desktop size with a mouse. On the test EPUB, the
// bookmark beside the progress bookmarks the page and shows it, in the reading
// footer and in the controls' footer; the Contents panel's Bookmarks tab lists
// it with the text the page opens with and where it is, goes to it from another
// chapter and saves the place, and removes it, leaving the empty state; the
// button removes a bookmark too. A bookmark made in one browser shows in another,
// and the server keeps it for the user. A comic page is bookmarked as 'Page N'.
// Nothing is requested from another host. Configured by environment: ORIEL_BASE
// (server URL including any BaseUrl), ORIEL_SERVER_ID, ORIEL_USER_ID,
// ORIEL_TOKEN, ORIEL_ITEM_ID (the test EPUB), ORIEL_CBZ_ID and ORIEL_BROWSER.
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
const comicId = env('ORIEL_CBZ_ID')
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

// The server's bookmarks for a book, and removing them, as the user.
const authorization = `MediaBrowser Client="oriel-e2e", Device="e2e", DeviceId="oriel-e2e-bookmarks", Version="1.0.0", Token="${token}"`
const stored = async id => {
    const response = await fetch(`${base}/Oriel/Bookmarks/${id}`, { headers: { Authorization: authorization } })
    if (!response.ok) fail(`GET /Oriel/Bookmarks returned ${response.status}`)
    return response.json()
}
const clear = async id => {
    for (const bookmark of await stored(id)) {
        await fetch(`${base}/Oriel/Bookmarks/${id}/${bookmark.id}`, { method: 'DELETE', headers: { Authorization: authorization } })
    }
}

const open = async (context, id) => {
    const page = await context.newPage()
    await page.goto(`${base}/Oriel/?id=${id}`)
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 })
        .catch(() => fail(`the reader did not render ${id}`))
    await pause(1500)
    return page
}

const showControls = async page => {
    if (await page.locator('#controls header').isVisible()) return
    if (!await pressAt(page, 0.5, setup.touch)) fail('no frame shows the page to tap')
    await pause(600)
}

// The bookmark button in the reading footer, or in the controls' footer.
const readingButton = page => page.locator('#reading-footer .bookmark')
const controlsButton = page => page.locator('#controls footer .bookmark')
// Whichever of the two is on screen: the controls' while they show, else the reading footer's.
const shownButton = async page => await controlsButton(page).isVisible() ? controlsButton(page) : readingButton(page)
const state = async button => ({ label: await button.getAttribute('aria-label'), pressed: await button.getAttribute('aria-pressed') })
const BOOKMARK = { label: 'Bookmark this page', pressed: 'false' }
const MARKED = { label: 'Remove the bookmark on this page', pressed: 'true' }
const same = (a, b) => a.label === b.label && a.pressed === b.pressed

// Opens Contents on its Bookmarks tab; returns the panel.
const openBookmarks = async page => {
    await showControls(page)
    await use(page.getByRole('button', { name: 'Contents' }))
    await pause(400)
    const panel = page.locator('#contents')
    if (!await panel.isVisible()) fail('Contents did not open')
    const tabs = (await panel.getByRole('tab').allInnerTexts()).map(text => text.trim())
    if (tabs.join('|') !== 'Contents|Bookmarks') fail(`the Contents panel's tabs are ${tabs.join(', ')}`)
    await use(panel.getByRole('tab', { name: 'Bookmarks' }))
    await pause(300)
    if (await panel.getByRole('tab', { name: 'Bookmarks' }).getAttribute('aria-selected') !== 'true') fail('the Bookmarks tab is not selected')
    return panel
}

// The rows of the Bookmarks tab: the text and the where line.
const rows = panel => panel.locator('.bookmarks li').evaluateAll(items => items.map(item => ({
    text: item.querySelector('.text')?.textContent?.trim() ?? '',
    where: item.querySelector('.where')?.textContent?.trim() ?? '',
})))

const section = page => page.evaluate(() => document.querySelector('foliate-view').renderer.getContents()[0]?.index)

const browser = await setup.engine.launch()
let failed = false
try {
    await clear(itemId)
    await clear(comicId)
    const context = await browser.newContext(setup.context)
    await context.addInitScript(value => {
        localStorage.setItem('jellyfin_credentials', value)
        // The reading gestures hint was seen on this device before.
        localStorage.setItem('oriel-hints', JSON.stringify({ first: true, scroll: true }))
    }, credentials)
    const elsewhere = []
    context.on('request', request => {
        const url = request.url()
        if (/^https?:/.test(url) && new URL(url).origin !== origin) elsewhere.push(url)
    })

    // Start in Chapter One, so the bookmark's text and place are known.
    let page = await open(context, itemId)
    await showControls(page)
    await use(page.getByRole('button', { name: 'Contents' }))
    await pause(400)
    await use(page.locator('#contents').getByRole('link', { name: /^Chapter One/ }))
    await pause(1500)
    if (await section(page) !== 0) fail('Contents did not go to Chapter One')

    // The button beside the progress bookmarks the page.
    const button = readingButton(page)
    if (!await button.isVisible()) fail('the reading footer has no bookmark button')
    const box = await button.boundingBox()
    if (!box || box.width < 44 || box.height < 44) fail('the bookmark button is under 44 px')
    if (!same(await state(button), BOOKMARK)) fail(`the bookmark button on an unmarked page is ${JSON.stringify(await state(button))}`)
    const footerPercent = (await page.locator('#reading-footer .progress').innerText()).trim()
    await use(button)
    await pause(800)
    if (!same(await state(button), MARKED)) fail(`after a press the bookmark button is ${JSON.stringify(await state(button))}`)
    const kept = await stored(itemId)
    if (kept.length !== 1 || !kept[0].text.startsWith('Chapter One Oriel smoke chapter one opens here.')) fail(`the server keeps ${JSON.stringify(kept)}`)
    await showControls(page)
    if (!same(await state(controlsButton(page)), MARKED)) fail('the controls\' footer does not show the page bookmarked')
    pass(`the bookmark beside the progress marks the page ('${MARKED.label}') and the server keeps '${kept[0].text.slice(0, 40)}…'`)

    // The Bookmarks tab lists it.
    let panel = await openBookmarks(page)
    let listed = await rows(panel)
    if (listed.length !== 1 || !listed[0].text.startsWith('Chapter One Oriel smoke') || listed[0].where !== `Chapter One · ${footerPercent}`) fail(`the Bookmarks tab lists ${JSON.stringify(listed)}`)
    pass(`the Bookmarks tab lists '${listed[0].text.slice(0, 30)}…' at '${listed[0].where}'`)

    // From another chapter, choosing it goes back and saves the place.
    await page.keyboard.press('Escape')
    await pause(300)
    await showControls(page)
    await use(page.getByRole('button', { name: 'Contents' }))
    await pause(400)
    await use(page.locator('#contents').getByRole('tab', { name: 'Contents' }))
    // Chapter Three is saved first, so going back to the bookmark is a change to save.
    const awayFirst = page.waitForRequest(request => request.method() === 'PUT' && request.url().includes(`/Oriel/Positions/${itemId}`), { timeout: 15_000 }).catch(() => null)
    await use(page.locator('#contents').getByRole('link', { name: /^Chapter Three/ }))
    await pause(1500)
    if (await section(page) !== 2) fail('Contents did not go to Chapter Three')
    if (!await awayFirst) fail('going to Chapter Three was not saved')
    if (!same(await state(readingButton(page)), BOOKMARK)) fail('Chapter Three shows as bookmarked')
    const saved = page.waitForRequest(request => request.method() === 'PUT' && request.url().includes(`/Oriel/Positions/${itemId}`), { timeout: 15_000 }).catch(() => null)
    panel = await openBookmarks(page)
    await use(panel.locator('.bookmarks li a').first())
    await pause(1500)
    if (await panel.isVisible()) fail('choosing a bookmark left the panel open')
    if (await section(page) !== 0) fail('choosing the bookmark did not go back to Chapter One')
    if (!same(await state(readingButton(page)), MARKED)) fail('back on the bookmarked page, the button does not show it')
    if (!await saved) fail('going to the bookmark was not saved to /Oriel/Positions')
    pass('from Chapter Three, choosing the bookmark goes back to it, closes the panel and saves the place')

    // Another browser sees it.
    const other = await browser.newContext(setup.context)
    await other.addInitScript(value => {
        localStorage.setItem('jellyfin_credentials', value)
        localStorage.setItem('oriel-hints', JSON.stringify({ first: true, scroll: true }))
    }, credentials)
    const second = await open(other, itemId)
    if (!same(await state(readingButton(second)), MARKED)) fail('another browser does not show the page bookmarked')
    listed = await rows(await openBookmarks(second))
    if (listed.length !== 1) fail(`another browser lists ${listed.length} bookmarks`)
    await other.close()
    pass('another browser opens on the bookmarked page and lists the bookmark')

    // Removing it from the list leaves the empty state.
    panel = await openBookmarks(page)
    await use(panel.getByRole('button', { name: 'Remove this bookmark' }))
    await pause(800)
    const empty = (await panel.locator('.bookmarks .empty').innerText()).replace(/\s+/g, ' ').trim()
    if (empty !== 'No bookmarks in this book yet. Tap the bookmark beside the progress to mark a page.') fail(`with no bookmarks the tab shows '${empty}'`)
    if ((await stored(itemId)).length) fail('the server still keeps the removed bookmark')
    await page.keyboard.press('Escape')
    await pause(300)
    if (!same(await state(readingButton(page)), BOOKMARK)) fail('after removing it, the page still shows as bookmarked')
    pass(`removing it from the list leaves '${empty}'`)

    // The button removes a bookmark too, in whichever footer shows.
    await use(await shownButton(page))
    await pause(800)
    if (!same(await state(readingButton(page)), MARKED)) fail('a press of the bookmark on screen did not bookmark the page')
    await use(await shownButton(page))
    await pause(800)
    if (!same(await state(readingButton(page)), BOOKMARK) || (await stored(itemId)).length) fail('a second press did not remove the bookmark')
    pass('a second press of the button removes the bookmark')
    await page.close()

    // A comic page is bookmarked by its number.
    const comic = await open(context, comicId)
    await use(readingButton(comic))
    await pause(800)
    const pages = await stored(comicId)
    if (pages.length !== 1 || !/^Page \d+$/.test(pages[0].text)) fail(`the comic's bookmark keeps ${JSON.stringify(pages)}`)
    pass(`a comic page is bookmarked as '${pages[0].text}'`)
    await clear(comicId)

    if (elsewhere.length) fail(`requests went to other hosts: ${[...new Set(elsewhere)].join(', ')}`)
    pass(`no request went to any host but ${origin}`)
} catch (error) {
    console.error(`FAIL: ${browserName}: ${error.message}`)
    failed = true
} finally {
    await clear(itemId).catch(() => {})
    await clear(comicId).catch(() => {})
    // WebKit can hang while closing; the result is already known, so stop waiting.
    await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 10_000))])
}
process.exit(failed ? 1 : 0)
