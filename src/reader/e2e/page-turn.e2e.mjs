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

const TURNS = ['Slide', 'Scroll', 'Fade', 'None']

const open = async (context, id) => {
    const page = await context.newPage()
    await page.goto(`${base}/Oriel/?id=${id}`)
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 })
        .catch(() => fail(`the reader did not render ${id}`))
    await until(async () => (await page.locator('#reading-footer .progress').innerText()).trim(), `the reader rendered ${id} but its footer shows no progress`)
    return page
}

const press = async (page, share, down = 0.5) => {
    if (!await pressAt(page, share, setup.touch, down)) fail('no frame shows the page to tap')
}

const controlsShown = page => page.locator('#controls header').isVisible()

// A tap in the middle, which shows the controls or hides them.
const toggleControls = async page => {
    const was = await controlsShown(page)
    await press(page, 0.5)
    await until(async () => await controlsShown(page) !== was, `a ${setup.touch ? 'tap' : 'click'} in the middle did not ${was ? 'hide' : 'show'} the controls`)
}

const openPrefs = async page => {
    if (!await controlsShown(page)) await toggleControls(page)
    await page.getByRole('button', { name: 'Preferences' }).click()
    const panel = page.locator('#prefs')
    await until(() => panel.isVisible(), 'Preferences did not open')
    return panel
}

const closeAll = async page => {
    await page.keyboard.press('Escape')
    await until(async () => !await page.locator('#prefs').isVisible(), 'Escape did not close Preferences')
    if (await controlsShown(page)) await toggleControls(page)
}

const chooseTurn = async (page, name) => {
    const panel = await openPrefs(page)
    const group = panel.getByRole('group', { name: 'Page turn' })
    if (!await group.isVisible()) fail('Preferences has no Page turn group')
    const button = group.getByRole('button', { name, exact: true })
    await button.click()
    await until(async () => await button.getAttribute('aria-pressed') === 'true', `${name} is not marked as chosen`)
    // Scroll lays the book out as a column, every other turn as pages.
    const flow = name === 'Scroll' ? 'scrolled' : 'paginated'
    await until(async () => (await where(page)).flow === flow, async () => `with ${name} the book's flow is ${(await where(page)).flow}, expected ${flow}`)
    await closeAll(page)
}

// Runs `act`, a turn, and waits for the book to come to rest after it.
const turnBy = async (page, act, message) => {
    const moved = await watchMove(page, message)
    await act()
    await moved()
    // The paginator ignores a turn that comes within 100 ms of the last one ending.
    await pause(150)
}

// The renderer's scroll position and screen size, and the section shown.
const where = page => page.evaluate(() => {
    const renderer = document.querySelector('foliate-view').renderer
    return { start: renderer.start, size: renderer.size, viewSize: renderer.viewSize, index: renderer.getContents()[0]?.index, flow: renderer.getAttribute('flow') }
})

const toStart = async page => {
    const moved = await watchMove(page, 'the book did not go to the start of Chapter One')
    await page.evaluate(() => document.querySelector('foliate-view').goTo(document.querySelector('foliate-view').book.toc[0].href))
    await moved()
}

// Samples the scroll position and the book's opacity on every frame for `ms`.
// Sets window.orielSampling once the first sample is taken.
const sample = (page, ms) => page.evaluate(ms => new Promise(resolve => {
    const view = document.querySelector('foliate-view')
    const samples = []
    const end = performance.now() + ms
    const tick = () => {
        samples.push({ start: Math.round(view.renderer.start), opacity: Number(getComputedStyle(view).opacity) })
        window.orielSampling = true
        if (performance.now() < end) requestAnimationFrame(tick)
        else resolve(samples)
    }
    window.orielSampling = false
    tick()
}), ms)

// Turns one page forward with the keyboard while sampling; gives where it
// started, where it ended, and the samples.
const sampledTurn = async page => {
    // From the start of Chapter One, which has a next page on every screen size.
    await toStart(page)
    const before = await where(page)
    const sampling = sample(page, 1200)
    await until(() => page.evaluate(() => window.orielSampling), 'the page did not start sampling the turn')
    await page.keyboard.press('ArrowRight')
    const samples = await sampling
    const onePageOn = after => after.index === before.index && Math.round(after.start - before.start) === Math.round(before.size)
    const after = await until(async () => { const now = await where(page); return onePageOn(now) && now },
        async () => { const now = await where(page); return `a turn went from ${before.index}:${before.start} to ${now.index}:${now.start}, expected one page of ${before.size} on` })
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
        // The reading gestures hint was seen on this device before.
        localStorage.setItem('oriel-hints', JSON.stringify({ first: true, scroll: true }))
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
    await turnBy(page, () => page.keyboard.press('ArrowRight'), 'ArrowRight did not turn the page in Chapter One')
    const pagedChapter = await chapter(page)
    await chooseTurn(page, 'Scroll')
    let shown = await where(page)
    if (shown.flow !== 'scrolled') fail(`with Scroll the book's flow is ${shown.flow}`)
    await until(async () => await chapter(page) === pagedChapter, async () => `switching to Scroll moved the book from ${pagedChapter} to ${await chapter(page)}`)
    await toStart(page)
    shown = await where(page)
    // One screen down, or to the section's end when less than a screen is left.
    const down = Math.round(Math.min(shown.size, shown.viewSize - shown.size - shown.start))
    const left = await pagesLeft(page)
    await turnBy(page, () => press(page, 0.5, 0.85), `a ${setup.touch ? 'tap' : 'click'} on the bottom third did not scroll`)
    let after = await where(page)
    if (Math.round(after.start - shown.start) !== down) fail(`a ${setup.touch ? 'tap' : 'click'} on the bottom third scrolled from ${shown.start} to ${after.start}, expected ${down} down`)
    await until(async () => await pagesLeft(page) === left - 1, async () => `scrolling down a screen took the pages left from ${left} to ${await pagesLeft(page)}, expected ${left - 1}`)
    await turnBy(page, () => press(page, 0.5, 0.15), `a ${setup.touch ? 'tap' : 'click'} on the top third did not scroll`)
    after = await where(page)
    if (Math.round(after.start) !== Math.round(shown.start)) fail(`a ${setup.touch ? 'tap' : 'click'} on the top third scrolled to ${after.start}, expected back to ${shown.start}`)
    await press(page, 0.5, 0.5)
    await until(() => controlsShown(page), `a ${setup.touch ? 'tap' : 'click'} in the middle did not show the controls in Scroll mode`)
    await toggleControls(page)
    await turnBy(page, () => page.keyboard.press('ArrowDown'), 'ArrowDown did not scroll')
    after = await where(page)
    if (Math.round(after.start - shown.start) !== down) fail(`ArrowDown scrolled from ${shown.start} to ${after.start}, expected ${down} down`)
    pass(`with Scroll the book is a vertical column; the bottom and top thirds and ArrowDown scroll a screen, and the pages left count screens (${left} to ${left - 1})`)

    // Pages in Scroll mode are screens: the total is every section's screens.
    const sections = await page.evaluate(() => document.querySelector('foliate-view').book.sections.length)
    let screens = 0
    for (let index = 0; index < sections; index++) {
        const moved = await watchMove(page, `could not show section ${index}`)
        await page.evaluate(i => document.querySelector('foliate-view').goTo(i), index)
        await moved()
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
    const total = await until(async () => {
        const match = /^(\d+)\/(\d+)$/.exec((await page.locator('#reading-footer .progress').innerText()).trim())
        return match && Number(match[2])
    }, `in Scroll mode the book counts no pages after 60 s, but its sections are ${screens} screens long`, 60_000)
    if (total !== screens) fail(`in Scroll mode the book counts ${total} pages, but its sections are ${screens} screens long`)
    pass(`in Scroll mode page / total counts ${total} screens`)

    // The place scrolled to is saved, and the book reopens there in Scroll mode.
    await toStart(page)
    await turnBy(page, () => press(page, 0.5, 0.85), `a ${setup.touch ? 'tap' : 'click'} on the bottom third did not scroll`)
    const scrolled = await where(page)
    const scrolledCfi = await page.evaluate(() => document.querySelector('foliate-view').lastLocation?.cfi)
    // The reader saves a move once it has rested 5 seconds.
    await page.waitForResponse(response => response.request().method() === 'PUT' && response.url().includes(`/Oriel/Positions/${itemId}`)
        && response.request().postDataJSON()?.cfi === scrolledCfi, { timeout: 15_000 })
        .catch(() => fail(`the scrolled place ${scrolledCfi} was not saved to /Oriel/Positions`))
    await page.close()
    page = await open(context, itemId)
    const there = now => now.flow === 'scrolled' && now.index === scrolled.index && Math.abs(now.start - scrolled.start) <= scrolled.size / 2
    await until(async () => there(await where(page)), async () => {
        const reopened = await where(page)
        return `the book reopened at ${reopened.index}:${reopened.start} (${reopened.flow}), expected ${scrolled.index}:${scrolled.start} scrolled`
    })
    pass(`a scrolled place is saved and the book reopens there in Scroll mode`)

    // Reset to defaults sets Slide again.
    const resetPanel = await openPrefs(page)
    await resetPanel.getByRole('button', { name: 'Reset to defaults', exact: true }).click()
    const dialog = page.getByRole('alertdialog')
    await until(() => dialog.isVisible(), 'Reset to defaults asked nothing')
    const body = (await dialog.locator('p').innerText()).trim()
    if (!body.startsWith('Size, spacing, margins and page turn on this')) fail(`the reset dialog says '${body}'`)
    await dialog.getByRole('button', { name: 'Reset', exact: true }).click()
    await until(async () => await resetPanel.getByRole('group', { name: 'Page turn' }).getByRole('button', { name: 'Slide', exact: true }).getAttribute('aria-pressed') === 'true', 'after Reset Slide is not chosen')
    await until(async () => (await where(page)).flow === 'paginated', async () => `after Reset the book's flow is ${(await where(page)).flow}`)
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
