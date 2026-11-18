// Checks bookmarks in the browser named by ORIEL_BROWSER: webkit at iPhone size
// with touch, or chromium at desktop size with a mouse. On the test EPUB, the
// bookmark beside the progress bookmarks the page and shows it, in the reading
// footer and in the controls' footer; the Contents panel's Bookmarks tab lists
// it with the text the page opens with and where it is, goes to it from another
// chapter and saves the place, and removes it, leaving the empty state; the
// button removes a bookmark too. A bookmark made in one browser shows in another,
// and the server keeps it for the user. With progress in Pages, a bookmark's row
// shows the page the footer showed on its page, the page counted again after a
// larger size, and, after a reload, the page of one the kept count never placed.
// A comic page is bookmarked as 'Page N'. With 5,000 bookmarks kept, the most
// Oriel keeps, the button says so and the server keeps no more; that check runs
// as a user made for it and deleted after it, which deletes the bookmarks too.
// Nothing is requested from another host. Configured by environment: ORIEL_BASE
// (server URL including any BaseUrl), ORIEL_SERVER_ID, ORIEL_USER_ID,
// ORIEL_TOKEN, ORIEL_ITEM_ID (the test EPUB), ORIEL_CBZ_ID and ORIEL_BROWSER.
// Exits non-zero on the first failed check.
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
const origin = new URL(base).origin
const token = env('ORIEL_TOKEN')
const serverId = env('ORIEL_SERVER_ID')
// What jellyfin-web keeps for a signed-in user, which the reader reads.
const credentialsOf = (userId, userToken) => JSON.stringify({
    Servers: [{
        Id: serverId,
        AccessToken: userToken,
        UserId: userId,
        ManualAddress: origin,
        DateLastAccessed: Date.now(),
    }],
})
const credentials = credentialsOf(env('ORIEL_USER_ID'), token)
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

// Presses a button or link as this screen's reader would: a tap on a touch screen, else a click.
const use = locator => setup.touch ? locator.tap() : locator.click()

// The server's bookmarks for a book, and removing them, as the user (or as the user `as` is the header of).
const headerOf = (userToken, device = 'oriel-e2e-bookmarks') => `MediaBrowser Client="oriel-e2e", Device="e2e", DeviceId="${device}", Version="1.0.0"${userToken ? `, Token="${userToken}"` : ''}`
const authorization = headerOf(token)
const stored = async (id, as = authorization) => {
    const response = await fetch(`${base}/Oriel/Bookmarks/${id}`, { headers: { Authorization: as } })
    if (!response.ok) fail(`GET /Oriel/Bookmarks returned ${response.status}`)
    return response.json()
}
const clear = async id => {
    const all = await stored(id)
    for (let at = 0; at < all.length; at += 50) {
        await Promise.all(all.slice(at, at + 50).map(bookmark =>
            fetch(`${base}/Oriel/Bookmarks/${id}/${bookmark.id}`, { method: 'DELETE', headers: { Authorization: authorization } })))
    }
}
const BOOKMARKS_FULL = 'You have 5,000 bookmarks, the most Oriel keeps. Remove one to add another.'
// Fills a user's bookmarks to the limit on a book, by importing them, and says how long the import took.
const fillBookmarks = async (id, as, from = 0) => {
    const now = new Date().toISOString()
    const file = {
        format: 'oriel-reading-data', version: 6, exportedAt: now, positions: [],
        bookmarks: Array.from({ length: 5000 }, (_, i) => ({ itemId: id, cfi: `epubcfi(/6/2!/4/2/1:${from + i})`, fraction: 0.01, text: `Planted ${from + i}`, createdAt: now })),
    }
    const started = performance.now()
    const response = await fetch(`${base}/Oriel/Import`, { method: 'POST', headers: { Authorization: as, 'Content-Type': 'application/json' }, body: JSON.stringify(file) })
    if (!response.ok) fail(`importing 5,000 bookmarks returned ${response.status}`)
    return { ...(await response.json()), seconds: ((performance.now() - started) / 1000).toFixed(1) }
}
// A user for the limit check, signed in: deleting the user afterwards deletes
// their 5,000 bookmarks with them, where removing them one by one takes minutes.
const makeUser = async () => {
    const name = `oriel-e2e-limit-${browserName}-${Date.now()}`
    const password = `limit-${Math.random().toString(36).slice(2)}`
    const created = await fetch(`${base}/Users/New`, {
        method: 'POST',
        headers: { Authorization: authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({ Name: name, Password: password }),
    })
    if (!created.ok) fail(`creating a user for the limit check returned ${created.status}`)
    const { Id: id } = await created.json()
    const signedIn = await fetch(`${base}/Users/AuthenticateByName`, {
        method: 'POST',
        headers: { Authorization: headerOf(null, 'oriel-e2e-bookmarks-limit'), 'Content-Type': 'application/json' },
        body: JSON.stringify({ Username: name, Pw: password }),
    })
    if (!signedIn.ok) fail(`signing in as the user for the limit check returned ${signedIn.status}`)
    const { AccessToken: userToken } = await signedIn.json()
    return { id, token: userToken }
}
const removeUser = async id => {
    const response = await fetch(`${base}/Users/${id}`, { method: 'DELETE', headers: { Authorization: authorization } })
    if (!response.ok) fail(`deleting the user for the limit check returned ${response.status}`)
}

// The reading footer's progress, as shown.
const progressShown = async page => (await page.locator('#reading-footer .progress').innerText()).trim()

// Opens the book once it has rendered and shows where it is.
const open = async (context, id) => {
    const page = await context.newPage()
    await page.goto(`${base}/Oriel/?id=${id}`)
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 })
        .catch(() => fail(`the reader did not render ${id}`))
    await until(() => progressShown(page), `the reader rendered ${id} but its footer shows no progress`)
    return page
}

const showControls = async page => {
    if (await page.locator('#controls header').isVisible()) return
    if (!await pressAt(page, 0.5, setup.touch)) fail('no frame shows the page to tap')
    await until(() => page.locator('#controls header').isVisible(), 'a tap in the middle of the page did not show the controls')
}

// Closes the panel shown with Escape.
const closePanel = async (page, panel) => {
    await page.keyboard.press('Escape')
    await until(async () => !await panel.isVisible(), 'Escape did not close the panel')
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
    const panel = page.locator('#contents')
    await until(() => panel.isVisible(), 'Contents did not open')
    const tabs = (await panel.getByRole('tab').allInnerTexts()).map(text => text.trim())
    if (tabs.join('|') !== 'Contents|Bookmarks|Highlights') fail(`the Contents panel's tabs are ${tabs.join(', ')}`)
    await use(panel.getByRole('tab', { name: 'Bookmarks' }))
    await until(async () => await panel.getByRole('tab', { name: 'Bookmarks' }).getAttribute('aria-selected') === 'true', 'the Bookmarks tab is not selected')
    return panel
}

// Opens Contents on its Contents tab and goes to the chapter whose entry starts with `chapter`, as section `index`.
const goToChapter = async (page, chapter, index) => {
    await showControls(page)
    await use(page.getByRole('button', { name: 'Contents' }))
    const panel = page.locator('#contents')
    await until(() => panel.isVisible(), 'Contents did not open')
    await use(panel.getByRole('tab', { name: 'Contents' }))
    const moved = await watchMove(page, `Contents did not move to ${chapter}`)
    await use(panel.getByRole('link', { name: new RegExp(`^${chapter}`) }))
    await moved()
    await until(async () => await section(page) === index, `Contents did not go to ${chapter}`)
}

// The rows of the Bookmarks tab: the text and the where line.
const rows = panel => panel.locator('.bookmarks li').evaluateAll(items => items.map(item => ({
    text: item.querySelector('.text')?.textContent?.trim() ?? '',
    where: item.querySelector('.where')?.textContent?.trim() ?? '',
})))

const section = page => page.evaluate(() => document.querySelector('foliate-view').renderer.getContents()[0]?.index)

// Waits for the reading footer to show page / total; gives the page shown and the total.
const counted = async (page, timeout = 60_000) => {
    const match = await until(async () => /^(\d+)\s*\/\s*(\d+)$/.exec(await progressShown(page)),
        async () => `the footer still shows '${await progressShown(page)}' after ${timeout / 1000} s, not page / total`, timeout)
    return { page: Number(match[1]), total: Number(match[2]) }
}

// Opens Preferences, runs `change` on it and closes it.
const preferences = async (page, change) => {
    await showControls(page)
    await use(page.getByRole('button', { name: 'Preferences' }))
    const panel = page.locator('#prefs')
    await until(() => panel.isVisible(), 'Preferences did not open')
    await change(panel)
    await closePanel(page, panel)
}

// The Bookmarks tab's where lines, once every row shows a page or `timeout` passes.
const pagedRows = async (page, timeout) => {
    const started = Date.now()
    for (;;) {
        const panel = await openBookmarks(page)
        const listed = await rows(panel)
        await closePanel(page, panel)
        if (listed.every(row => / · page \d+$/.test(row.where)) || Date.now() - started > timeout) return listed
        // The rows are read again from a fresh panel; a second between looks keeps the panel from flickering open and shut.
        await pause(1000)
    }
}

const browser = await setup.engine.launch()
let failed = false
let limitUser = null
try {
    await clear(itemId)
    await clear(comicId)
    const elsewhere = []
    // A context signed in as the user `as` holds credentials for, with the gestures hint seen.
    const contextFor = async as => {
        const made = await browser.newContext(setup.context)
        await made.addInitScript(value => {
            localStorage.setItem('jellyfin_credentials', value)
            // The reading gestures hint was seen on this device before.
            localStorage.setItem('oriel-hints', JSON.stringify({ first: true, scroll: true }))
        }, as)
        made.on('request', request => {
            const url = request.url()
            if (/^https?:/.test(url) && new URL(url).origin !== origin) elsewhere.push(url)
        })
        return made
    }
    const context = await contextFor(credentials)

    // Start in Chapter One, so the bookmark's text and place are known.
    let page = await open(context, itemId)
    await goToChapter(page, 'Chapter One', 0)

    // The button beside the progress bookmarks the page.
    const button = readingButton(page)
    if (!await button.isVisible()) fail('the reading footer has no bookmark button')
    const box = await button.boundingBox()
    if (!box || box.width < 44 || box.height < 44) fail('the bookmark button is under 44 px')
    if (!same(await state(button), BOOKMARK)) fail(`the bookmark button on an unmarked page is ${JSON.stringify(await state(button))}`)
    const footerPercent = await progressShown(page)
    await use(button)
    await until(async () => same(await state(button), MARKED), async () => `after a press the bookmark button is ${JSON.stringify(await state(button))}`)
    const kept = await until(async () => { const all = await stored(itemId); return all.length ? all : null }, 'the server keeps no bookmark after a press')
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
    await closePanel(page, panel)
    // Chapter Three is saved first, so going back to the bookmark is a change to save. A save
    // of Chapter One still waiting out its delay does not count: it would leave Chapter Three
    // unsaved, and going back to Chapter One then rightly saves nothing.
    const chapterOne = `${kept[0].cfi.split('!')[0]}!`
    const awayFirst = page.waitForRequest(request => request.method() === 'PUT' && request.url().includes(`/Oriel/Positions/${itemId}`)
        && !String(request.postDataJSON()?.cfi).startsWith(chapterOne), { timeout: 15_000 }).catch(() => null)
    await goToChapter(page, 'Chapter Three', 2)
    if (!await awayFirst) fail('going to Chapter Three was not saved')
    if (!same(await state(readingButton(page)), BOOKMARK)) fail('Chapter Three shows as bookmarked')
    const saved = page.waitForRequest(request => request.method() === 'PUT' && request.url().includes(`/Oriel/Positions/${itemId}`), { timeout: 15_000 }).catch(() => null)
    panel = await openBookmarks(page)
    await use(panel.locator('.bookmarks li a').first())
    await until(async () => await section(page) === 0, 'choosing the bookmark did not go back to Chapter One')
    await until(async () => !await panel.isVisible(), 'choosing a bookmark left the panel open')
    await until(async () => same(await state(readingButton(page)), MARKED), 'back on the bookmarked page, the button does not show it')
    if (!await saved) fail('going to the bookmark was not saved to /Oriel/Positions')
    pass('from Chapter Three, choosing the bookmark goes back to it, closes the panel and saves the place')

    // Another browser sees it.
    const other = await contextFor(credentials)
    const second = await open(other, itemId)
    await until(async () => same(await state(readingButton(second)), MARKED), 'another browser does not show the page bookmarked')
    listed = await rows(await openBookmarks(second))
    if (listed.length !== 1) fail(`another browser lists ${listed.length} bookmarks`)
    await other.close()
    pass('another browser opens on the bookmarked page and lists the bookmark')

    // Removing it from the list leaves the empty state.
    panel = await openBookmarks(page)
    await use(panel.getByRole('button', { name: 'Remove this bookmark' }))
    const emptyText = async () => (await panel.locator('.bookmarks .empty').count()) ? (await panel.locator('.bookmarks .empty').innerText()).replace(/\s+/g, ' ').trim() : ''
    const empty = await until(emptyText, 'removing the bookmark from the list did not leave the empty state')
    if (empty !== 'No bookmarks in this book yet. Tap the bookmark beside the progress to mark a page.') fail(`with no bookmarks the tab shows '${empty}'`)
    await until(async () => !(await stored(itemId)).length, 'the server still keeps the removed bookmark')
    await closePanel(page, panel)
    if (!same(await state(readingButton(page)), BOOKMARK)) fail('after removing it, the page still shows as bookmarked')
    pass(`removing it from the list leaves '${empty}'`)

    // The button removes a bookmark too, in whichever footer shows.
    await use(await shownButton(page))
    await until(async () => same(await state(readingButton(page)), MARKED), 'a press of the bookmark on screen did not bookmark the page')
    await until(async () => (await stored(itemId)).length === 1, 'a press of the bookmark on screen kept nothing on the server')
    await use(await shownButton(page))
    await until(async () => same(await state(readingButton(page)), BOOKMARK) && !(await stored(itemId)).length, 'a second press did not remove the bookmark')
    pass('a second press of the button removes the bookmark')

    // With progress in Pages, a bookmark shows the page the footer shows on it.
    await preferences(page, async panel => {
        const pages = panel.getByRole('radio', { name: 'Pages', exact: true })
        await use(pages)
        await until(() => pages.isChecked(), 'Pages is not chosen after a press')
    })
    await goToChapter(page, 'Chapter Three', 2)
    const turned = await watchMove(page, 'ArrowRight did not turn the page in Chapter Three')
    await page.keyboard.press('ArrowRight')
    await turned()
    const before = await counted(page)
    await use(readingButton(page))
    await until(async () => (await stored(itemId)).length === 1, 'the page in Chapter Three was not bookmarked')
    panel = await openBookmarks(page)
    listed = await rows(panel)
    if (listed.length !== 1 || listed[0].where !== `Chapter Three · page ${before.page}`) fail(`with Pages the Bookmarks tab lists ${JSON.stringify(listed)}, expected 'Chapter Three · page ${before.page}'`)
    await closePanel(page, panel)
    pass(`with Pages the bookmark shows '${listed[0].where}', the page the footer showed`)

    // A larger size counts again, and the row shows the page counted.
    await preferences(page, async panel => {
        const size = async () => page.evaluate(() => JSON.parse(localStorage.getItem('oriel-settings') ?? '{}').size ?? null)
        for (let i = 0; i < 4; i++) {
            const was = await size()
            await use(panel.getByRole('button', { name: 'More size', exact: true }))
            await until(async () => await size() !== was, `More size press ${i + 1} did not change the size`)
        }
    })
    const larger = await until(async () => { const now = await counted(page); return now.total !== before.total && now }, async () => `four sizes up the book still counts ${(await counted(page)).total} pages`, 60_000)
    panel = await openBookmarks(page)
    const goneTo = await watchMove(page, 'choosing the bookmark four sizes up did not move to it')
    await use(panel.locator('.bookmarks li a').first())
    await goneTo()
    await until(async () => !await panel.isVisible(), 'choosing the bookmark left the panel open')
    const onIt = await counted(page, 5000)
    listed = await pagedRows(page, 5000)
    if (listed[0]?.where !== `Chapter Three · page ${onIt.page}` || onIt.page === before.page) fail(`four sizes up the Bookmarks tab lists ${JSON.stringify(listed)}; the footer shows page ${onIt.page}, it showed ${before.page} before; ${larger.total} pages in all`)
    pass(`four sizes up the bookmark shows '${listed[0].where}', the page counted again, not page ${before.page}`)

    // A bookmark the kept count never placed, added elsewhere, is placed after a reload.
    const addedElsewhere = await fetch(`${base}/Oriel/Bookmarks/${itemId}`, {
        method: 'POST',
        headers: { Authorization: authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cfi: kept[0].cfi, fraction: kept[0].fraction, text: kept[0].text }),
    })
    if (!addedElsewhere.ok) fail(`POST /Oriel/Bookmarks returned ${addedElsewhere.status}`)
    await page.reload()
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 })
    const reloaded = await counted(page, 5000)
    listed = await pagedRows(page, 30_000)
    const wanted = [`Chapter One · page 1`, `Chapter Three · page ${reloaded.page}`]
    if (listed.map(row => row.where).join('|') !== wanted.join('|')) fail(`after a reload with a bookmark added elsewhere the Bookmarks tab lists ${JSON.stringify(listed)}, expected ${wanted.join(', ')}`)
    pass(`after a reload a bookmark added elsewhere is placed too: ${listed.map(row => `'${row.where}'`).join(', ')}`)
    await page.close()

    // A comic page is bookmarked by its number.
    const comic = await open(context, comicId)
    await use(readingButton(comic))
    const pages = await until(async () => { const all = await stored(comicId); return all.length ? all : null }, 'a press on a comic page kept no bookmark')
    if (pages.length !== 1 || !/^Page \d+$/.test(pages[0].text)) fail(`the comic's bookmark keeps ${JSON.stringify(pages)}`)
    pass(`a comic page is bookmarked as '${pages[0].text}'`)
    await clear(comicId)
    await comic.close()

    // At the limit: the button says so, and the server keeps no more. As a user made for it,
    // deleted afterwards with their bookmarks.
    limitUser = await makeUser()
    const limitAuthorization = headerOf(limitUser.token)
    const planted = await fillBookmarks(comicId, limitAuthorization)
    if (planted.bookmarks !== 5000) fail(`importing 5,000 bookmarks added ${planted.bookmarks}`)
    const limitContext = await contextFor(credentialsOf(limitUser.id, limitUser.token))
    page = await open(limitContext, itemId)
    await use(await shownButton(page))
    const full = await page.waitForFunction(text => [...document.querySelectorAll('.notice span')].some(span => span.textContent === text), BOOKMARKS_FULL, { timeout: 10_000 })
        .then(() => true, () => false)
    if (!full) fail(`at 5,000 bookmarks the reader did not say '${BOOKMARKS_FULL}'`)
    if ((await stored(itemId, limitAuthorization)).length) fail('a bookmark past the limit was kept')
    if (!same(await state(await shownButton(page)), BOOKMARK)) fail(`at the limit the button shows ${JSON.stringify(await state(await shownButton(page)))}`)
    const again = await fillBookmarks(comicId, limitAuthorization, 5000)
    if (again.bookmarks !== 0 || again.limited?.join() !== 'bookmarks') fail(`importing past the limit gave ${JSON.stringify({ bookmarks: again.bookmarks, limited: again.limited })}`)
    pass(`at 5,000 bookmarks the button says '${BOOKMARKS_FULL}', nothing more is kept, and an import past it names the limit (importing 5,000 took ${planted.seconds} s)`)
    await limitContext.close()
    await removeUser(limitUser.id)
    limitUser = null

    if (elsewhere.length) fail(`requests went to other hosts: ${[...new Set(elsewhere)].join(', ')}`)
    pass(`no request went to any host but ${origin}`)
} catch (error) {
    console.error(`FAIL: ${browserName}: ${error.message}`)
    failed = true
} finally {
    await clear(itemId).catch(() => {})
    await clear(comicId).catch(() => {})
    if (limitUser) await removeUser(limitUser.id).catch(() => {})
    // WebKit can hang while closing; the result is already known, so stop waiting.
    await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 10_000))])
}
process.exit(failed ? 1 : 0)
