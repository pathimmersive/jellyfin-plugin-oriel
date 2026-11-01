// Checks Page turn in the browser named by ORIEL_BROWSER: webkit at iPhone
// size with touch, or chromium at desktop size with a mouse. Preferences offers
// Slide, Scroll, Fade and None, Slide at first. With Slide a turn passes through
// in-between positions; with None it jumps; with Fade the book dims during the
// turn; each ends one page on. With Scroll the book is a vertical column that
// keeps the chapter on screen; a tap or click on the bottom third scrolls down
// a screen, on the top third up a screen, and in the middle shows the
// controls; the arrow keys scroll a screen; a page is a screen for the pages
// left in the chapter and page / total; the place scrolled to is saved and the
// book reopens there in Scroll mode. Reset to defaults sets Slide again. On the
// test comic and PDF the buttons are disabled. Nothing is requested from
// another host. Configured by environment: ORIEL_BASE (server URL including any
// BaseUrl), ORIEL_SERVER_ID, ORIEL_USER_ID, ORIEL_TOKEN, ORIEL_ITEM_ID (the
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

const TURNS = ['Slide', 'Scroll', 'Fade', 'None']

const open = async (context, id) => {
    const page = await context.newPage()
    await page.goto(`${base}/Oriel/?id=${id}`)
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 })
        .catch(() => fail(`the reader did not render ${id}`))
    await pause(1000)
    return page
}

const press = async (page, share, down = 0.5) => {
    if (!await pressAt(page, share, setup.touch, down)) fail('no frame shows the page to tap')
    await pause(900)
}

const controlsShown = page => page.locator('#controls header').isVisible()

const openPrefs = async page => {
    if (!await controlsShown(page)) await press(page, 0.5)
    await page.getByRole('button', { name: 'Preferences' }).click()
    await pause(400)
    const panel = page.locator('#prefs')
    if (!await panel.isVisible()) fail('Preferences did not open')
    return panel
}

const closeAll = async page => {
    await page.keyboard.press('Escape')
    await pause(300)
    if (await controlsShown(page)) await press(page, 0.5)
}

const chooseTurn = async (page, name) => {
    const panel = await openPrefs(page)
    const group = panel.getByRole('group', { name: 'Page turn' })
    if (!await group.isVisible()) fail('Preferences has no Page turn group')
    const button = group.getByRole('button', { name, exact: true })
    await button.click()
    await pause(1200)
    if (await button.getAttribute('aria-pressed') !== 'true') fail(`${name} is not marked as chosen`)
    await closeAll(page)
}

// The renderer's scroll position and screen size, and the section shown.
const where = page => page.evaluate(() => {
    const renderer = document.querySelector('foliate-view').renderer
    return { start: renderer.start, size: renderer.size, viewSize: renderer.viewSize, index: renderer.getContents()[0]?.index, flow: renderer.getAttribute('flow') }
})

const toStart = async page => {
    await page.evaluate(() => document.querySelector('foliate-view').goTo(document.querySelector('foliate-view').book.toc[0].href))
    await pause(1200)
}

// Samples the scroll position and the book's opacity on every frame for `ms`.
const sample = (page, ms) => page.evaluate(ms => new Promise(resolve => {
    const view = document.querySelector('foliate-view')
    const samples = []
    const until = performance.now() + ms
    const tick = () => {
        samples.push({ start: Math.round(view.renderer.start), opacity: Number(getComputedStyle(view).opacity) })
        if (performance.now() < until) requestAnimationFrame(tick)
        else resolve(samples)
    }
    tick()
}), ms)

// Turns one page forward with the keyboard while sampling; gives where it
// started, where it ended, and the samples.
const sampledTurn = async page => {
    // From the start of Chapter One, which has a next page on every screen size.
    await toStart(page)
    const before = await where(page)
    const sampling = sample(page, 1200)
    await pause(50)
    await page.keyboard.press('ArrowRight')
    const samples = await sampling
    await pause(300)
    const after = await where(page)
    if (after.index !== before.index || Math.round(after.start - before.start) !== Math.round(before.size)) {
        fail(`a turn went from ${before.index}:${before.start} to ${after.index}:${after.start}, expected one page of ${before.size} on`)
    }
    return { before, after, samples }
}

const chapter = page => page.locator('#reading-footer .chapter').innerText().then(text => text.trim())
const pagesLeft = page => page.locator('#reading-footer .left .count').innerText().then(text => Number(text.trim()))

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
    let page = await open(context, itemId)
    await toStart(page)

    // The group and its default.
    const panel = await openPrefs(page)
    const group = panel.getByRole('group', { name: 'Page turn' })
    if (!await group.isVisible()) fail('Preferences has no Page turn group')
    const names = (await group.getByRole('button').allInnerTexts()).map(text => text.trim())
    if (names.join(', ') !== TURNS.join(', ')) fail(`Page turn offers ${names.join(', ')}, expected ${TURNS.join(', ')}`)
    if (await group.getByRole('button', { name: 'Slide', exact: true }).getAttribute('aria-pressed') !== 'true') fail('Slide is not chosen at first')
    await closeAll(page)
    pass(`Page turn offers ${TURNS.join(', ')}, Slide at first`)

    // Slide passes through in-between positions; None jumps.
    let turn = await sampledTurn(page)
    let between = new Set(turn.samples.map(s => s.start).filter(start => start > turn.before.start && start < turn.after.start))
    if (between.size < 2) fail(`with Slide a turn showed ${between.size} in-between positions, expected it to slide`)
    pass(`with Slide a turn slides through ${between.size} in-between positions to the next page`)
    await chooseTurn(page, 'None')
    turn = await sampledTurn(page)
    between = new Set(turn.samples.map(s => s.start).filter(start => start > turn.before.start && start < turn.after.start))
    if (between.size) fail(`with None a turn passed through ${[...between].join(', ')}`)
    pass('with None a turn jumps straight to the next page')

    // Fade dims the book during the turn.
    await chooseTurn(page, 'Fade')
    turn = await sampledTurn(page)
    const dimmest = Math.min(...turn.samples.map(s => s.opacity))
    if (dimmest > 0.5) fail(`with Fade the book's opacity fell only to ${dimmest} during a turn`)
    if (turn.samples.at(-1).opacity !== 1) fail(`with Fade the book's opacity ends at ${turn.samples.at(-1).opacity}`)
    pass(`with Fade the book fades to ${dimmest} and back during a turn`)

    // Scroll: a vertical column that keeps the chapter.
    await toStart(page)
    await page.keyboard.press('ArrowRight')
    await pause(1000)
    const pagedChapter = await chapter(page)
    await chooseTurn(page, 'Scroll')
    let shown = await where(page)
    if (shown.flow !== 'scrolled') fail(`with Scroll the book's flow is ${shown.flow}`)
    if (await chapter(page) !== pagedChapter) fail(`switching to Scroll moved the book from ${pagedChapter} to ${await chapter(page)}`)
    await toStart(page)
    shown = await where(page)
    // One screen down, or to the section's end when less than a screen is left.
    const down = Math.round(Math.min(shown.size, shown.viewSize - shown.size - shown.start))
    const left = await pagesLeft(page)
    await press(page, 0.5, 0.85)
    let after = await where(page)
    if (Math.round(after.start - shown.start) !== down) fail(`a ${setup.touch ? 'tap' : 'click'} on the bottom third scrolled from ${shown.start} to ${after.start}, expected ${down} down`)
    if (await pagesLeft(page) !== left - 1) fail(`scrolling down a screen took the pages left from ${left} to ${await pagesLeft(page)}, expected ${left - 1}`)
    await press(page, 0.5, 0.15)
    after = await where(page)
    if (Math.round(after.start) !== Math.round(shown.start)) fail(`a ${setup.touch ? 'tap' : 'click'} on the top third scrolled to ${after.start}, expected back to ${shown.start}`)
    await press(page, 0.5, 0.5)
    if (!await controlsShown(page)) fail(`a ${setup.touch ? 'tap' : 'click'} in the middle did not show the controls in Scroll mode`)
    await press(page, 0.5, 0.5)
    await page.keyboard.press('ArrowDown')
    await pause(900)
    after = await where(page)
    if (Math.round(after.start - shown.start) !== down) fail(`ArrowDown scrolled from ${shown.start} to ${after.start}, expected ${down} down`)
    pass(`with Scroll the book is a vertical column; the bottom and top thirds and ArrowDown scroll a screen, and the pages left count screens (${left} to ${left - 1})`)

    // Pages in Scroll mode are screens: the total is every section's screens.
    const sections = await page.evaluate(() => document.querySelector('foliate-view').book.sections.length)
    let screens = 0
    for (let index = 0; index < sections; index++) {
        await page.evaluate(i => document.querySelector('foliate-view').goTo(i), index)
        await pause(1000)
        screens += await page.evaluate(() => {
            const renderer = document.querySelector('foliate-view').renderer
            const { doc } = renderer.getContents()[0]
            const range = doc.createRange()
            range.selectNodeContents(doc.body)
            return Math.max(1, Math.ceil((range.getBoundingClientRect().bottom - doc.documentElement.getBoundingClientRect().top) / renderer.size - 0.01))
        })
    }
    const prefs = await openPrefs(page)
    await prefs.getByRole('radio', { name: 'Pages', exact: true }).click()
    await closeAll(page)
    const started = Date.now()
    let total = null
    while (total === null && Date.now() - started < 60_000) {
        const match = /^(\d+)\/(\d+)$/.exec((await page.locator('#reading-footer .progress').innerText()).trim())
        if (match) total = Number(match[2])
        else await pause(250)
    }
    if (total !== screens) fail(`in Scroll mode the book counts ${total} pages, but its sections are ${screens} screens long`)
    pass(`in Scroll mode page / total counts ${total} screens`)

    // The place scrolled to is saved, and the book reopens there in Scroll mode.
    await toStart(page)
    await press(page, 0.5, 0.85)
    const scrolled = await where(page)
    await pause(6000)
    await page.close()
    page = await open(context, itemId)
    await pause(800)
    const reopened = await where(page)
    if (reopened.flow !== 'scrolled' || reopened.index !== scrolled.index || Math.abs(reopened.start - scrolled.start) > scrolled.size / 2) {
        fail(`the book reopened at ${reopened.index}:${reopened.start} (${reopened.flow}), expected ${scrolled.index}:${scrolled.start} scrolled`)
    }
    pass(`a scrolled place is saved and the book reopens there in Scroll mode`)

    // Reset to defaults sets Slide again.
    const resetPanel = await openPrefs(page)
    await resetPanel.getByRole('button', { name: 'Reset to defaults', exact: true }).click()
    await pause(300)
    const dialog = page.getByRole('alertdialog')
    const body = (await dialog.locator('p').innerText()).trim()
    if (!body.startsWith('Size, spacing, margins and page turn on this')) fail(`the reset dialog says '${body}'`)
    await dialog.getByRole('button', { name: 'Reset', exact: true }).click()
    await pause(1500)
    if (await resetPanel.getByRole('group', { name: 'Page turn' }).getByRole('button', { name: 'Slide', exact: true }).getAttribute('aria-pressed') !== 'true') fail('after Reset Slide is not chosen')
    if ((await where(page)).flow !== 'paginated') fail(`after Reset the book's flow is ${(await where(page)).flow}`)
    pass('Reset to defaults names page turn and sets Slide again')
    await page.close()

    // Comics and PDFs keep their page turns.
    for (const [name, id] of [['comic', comicId], ['PDF', pdfId]]) {
        const fixed = await open(context, id)
        const fixedPanel = await openPrefs(fixed)
        for (const label of TURNS) {
            if (await fixedPanel.getByRole('group', { name: 'Page turn' }).getByRole('button', { name: label, exact: true }).isEnabled()) fail(`${label} is enabled for the ${name}`)
        }
        pass(`on the ${name} the Page turn buttons are disabled`)
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
