// Checks that a page turn costs the same however much is marked, in the browser
// named by ORIEL_BROWSER: webkit at iPhone size with touch, or chromium at
// desktop size. In the long book, as a user made for the run, it turns the same
// 40 pages with nothing marked and with 5,000 bookmarks and 20,000 highlights
// (the most a user keeps), and the turns with marks take at most 1.5 times as
// long by the mean of the middle half of their times. WebKit's clock counts
// whole milliseconds and a turn there can take 1 to 3 ms, so a single turn, or
// a median, moves by a tick; the mean of 20 averages the ticks out, and leaving
// out the quickest and slowest quarters leaves out a stray pause. The bookmarks are in the chapters before the ones turned
// through, so no turn finds one on its page and stops looking early; every
// chapter has its 500 highlights. A turn is timed from the key to the end of
// what the reader does when the new page shows, with Page turn at None: the 300 ms
// a slide takes would hide the work. Both means are from one run,
// so the machine's speed cancels. The marks must be there to count: the
// highlights are drawn, and a page with a bookmark says so. In Chromium, from
// the browser's own trace, opening the book and turning into a chapter lay each
// section out in full once, and it is the paginator that asks for it, not the
// reader measuring a layout about to change. Configured by environment: ORIEL_BASE
// (server URL including any BaseUrl), ORIEL_SERVER_ID, ORIEL_TOKEN (an admin's), ORIEL_LONG_ID (the long test EPUB) and
// ORIEL_BROWSER. Exits non-zero on the first failed check.
import { randomUUID } from 'node:crypto'
import { chromium, devices, webkit } from 'playwright'
import { CHAPTERS, cfiOf, PARAGRAPHS, paragraph } from './make-long-epub.mjs'
import { pause, until } from './wait.mjs'

const env = name => {
    const value = process.env[name]
    if (!value) {
        console.error(`FAIL: ${name} is not set`)
        process.exit(2)
    }
    return value
}

const base = env('ORIEL_BASE')
const itemId = env('ORIEL_LONG_ID')
const browserName = env('ORIEL_BROWSER')
const setups = {
    webkit: { engine: webkit, context: { ...devices['iPhone 13'] } },
    chromium: { engine: chromium, context: { viewport: { width: 1280, height: 800 } } },
}
const setup = setups[browserName]
if (!setup) {
    console.error(`FAIL: ORIEL_BROWSER is '${browserName}', expected webkit or chromium`)
    process.exit(2)
}

const BOOKMARKS = 5_000
const HIGHLIGHTS = 20_000
const TURNS = 40
const BOUND = 1.5
// The chapter the turns start in, and how many chapters from the first have bookmarks. The
// ten chapters from START hold more than 40 pages at desktop size.
const START = 31
const BOOKMARKED = 30

const fail = message => { throw new Error(message) }
const pass = message => console.log(`PASS: ${browserName}: ${message}`)
const header = (user, token) => `MediaBrowser Client="oriel-e2e", Device="e2e", DeviceId="oriel-e2e-turns-${user}", Version="1.0.0"${token ? `, Token="${token}"` : ''}`
const call = async (path, authorization, init = {}) => {
    const response = await fetch(`${base}${path}`, { ...init, headers: { Authorization: authorization, 'Content-Type': 'application/json', ...init.headers } })
    const text = await response.text()
    if (!response.ok) fail(`${init.method ?? 'GET'} ${path} returned ${response.status}: ${text}`)
    return text ? JSON.parse(text) : null
}

// The import that marks the book: bookmarks over the first BOOKMARKED chapters and highlights over all of them.
const marks = () => {
    const book = { itemId, title: 'Oriel Long Book', authors: ['Oriel'], fileName: 'oriel-long.epub' }
    const at = i => new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString()
    const spread = (count, chapters, mark) => Array.from({ length: count }, (_, i) => {
        const perChapter = Math.ceil(count / chapters)
        const chapter = Math.floor(i / perChapter) + 1
        const within = i % perChapter
        const number = within % PARAGRAPHS + 1
        // The ones sharing a paragraph follow each other in it, ten characters apart.
        const offset = Math.floor(within / PARAGRAPHS) * 10
        return { ...book, ...mark(chapter, number, offset), fraction: (chapter - 1 + number / (PARAGRAPHS + 1)) / CHAPTERS, createdAt: at(i) }
    })
    return {
        format: 'oriel-reading-data',
        version: 6,
        positions: [],
        bookmarks: spread(BOOKMARKS, BOOKMARKED, (chapter, number, offset) =>
            ({ cfi: cfiOf(chapter, number, offset), text: paragraph(chapter, number).slice(offset) })),
        highlights: spread(HIGHLIGHTS, CHAPTERS, (chapter, number, offset) =>
            ({ cfi: cfiOf(chapter, number, offset, offset + 5), colour: 'yellow', text: paragraph(chapter, number).slice(offset, offset + 5), note: '' })),
    }
}

const open = async context => {
    const page = await context.newPage()
    await page.goto(`${base}/Oriel/?id=${itemId}`)
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 60_000 }).catch(() => fail('the reader did not render the long book'))
    // The reading gestures hint, shown on the first open.
    await page.keyboard.press('Escape')
    return page
}

// Goes to the start of a chapter, as a contents link does.
const goTo = async (page, chapter) => {
    await page.evaluate(index => document.querySelector('foliate-view').goTo(index), chapter - 1)
    const there = () => page.evaluate(() => {
        const { renderer } = document.querySelector('foliate-view')
        return `${renderer.getContents()[0]?.index}, page ${renderer.page}`
    })
    await until(async () => await there() === `${chapter - 1}, page 1`, async () => `the book did not go to the start of chapter ${chapter}: it is at section ${await there()}`)
}

// Turns pages with the right arrow key and gives each turn's time in ms.
const turns = (page, count) => page.evaluate(async count => {
    const view = document.querySelector('foliate-view')
    // Added after the reader's own listeners, so it runs when they have.
    let moved = 0
    const onMove = () => { moved = performance.now() }
    view.addEventListener('relocate', onMove)
    const times = []
    for (let i = 0; i < count; i++) {
        moved = 0
        const before = view.lastLocation.cfi
        const pressed = performance.now()
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
        // The paginator takes no turn for 100 ms after one, and a turn into the next chapter moves more than once.
        while (!moved || performance.now() - moved < 200) {
            if (performance.now() - pressed > 10_000) throw new Error('the right arrow key did not turn the page')
            await new Promise(resolve => setTimeout(resolve, 20))
        }
        if (view.lastLocation.cfi === before) throw new Error('the right arrow key left the page as it was')
        times.push(moved - pressed)
    }
    view.removeEventListener('relocate', onMove)
    return times
}, count)

// What Chromium laid out in full in the book's frames during `action`: what asked for each layout (empty when the browser did by itself).
const laidOut = async (page, action) => {
    const cdp = await page.context().newCDPSession(page)
    const { frameTree } = await cdp.send('Page.getFrameTree')
    const events = []
    cdp.on('Tracing.dataCollected', ({ value }) => events.push(...value))
    await cdp.send('Tracing.start', { transferMode: 'ReportEvents', categories: 'devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.stack' })
    await action()
    const done = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve))
    await cdp.send('Tracing.end')
    await done
    await cdp.detach()
    return events.filter(event => event.name === 'Layout' && event.args.beginData)
        .sort((a, b) => a.ts - b.ts)
        .map(event => event.args.beginData)
        .filter(({ frame, dirtyObjects, totalObjects }) => frame !== frameTree.frame.id && totalObjects > PARAGRAPHS && dirtyObjects > totalObjects / 2)
        .map(({ stackTrace }) => stackTrace?.[0]?.url?.split('/').pop() ?? '')
}

// Layouts the trace must hold: one, asked for by the paginator.
const onceByPaginator = (layouts, what) => {
    if (layouts.length !== 1 || !layouts[0].startsWith('paginator')) fail(`${what}: the section is laid out in full ${layouts.length} times, asked for by ${layouts.map(each => each || 'the browser').join(', ') || 'nothing'}; expected once, by the paginator`)
}

const median = times => {
    const sorted = [...times].sort((a, b) => a - b)
    return (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
}

// The mean of the middle half: the quickest and slowest quarters left out.
const middleMean = times => {
    const sorted = [...times].sort((a, b) => a - b)
    const middle = sorted.slice(times.length / 4, times.length - times.length / 4)
    return middle.reduce((sum, time) => sum + time, 0) / middle.length
}

// Times the turns from the start of a chapter, after some to warm up.
const measure = async page => {
    await goTo(page, START)
    await turns(page, 6)
    await goTo(page, START)
    return turns(page, TURNS)
}

const bookmarkShown = async page => await page.locator('#reading-footer .bookmark').getAttribute('aria-pressed') === 'true'

const admin = header('admin', env('ORIEL_TOKEN'))
const name = `turns-${browserName}`
const password = randomUUID()
const browser = await setup.engine.launch()
let userId = null
let failed = false
try {
    userId = (await call('/Users/New', admin, { method: 'POST', body: JSON.stringify({ Name: name, Password: password }) })).Id
    const { AccessToken: token } = await call('/Users/AuthenticateByName', header(name), { method: 'POST', body: JSON.stringify({ Username: name, Pw: password }) })
    const mine = header(name, token)
    const credentials = JSON.stringify({
        Servers: [{ Id: env('ORIEL_SERVER_ID'), AccessToken: token, UserId: userId, ManualAddress: new URL(base).origin, DateLastAccessed: Date.now() }],
    })
    const context = await browser.newContext(setup.context)
    await context.addInitScript(credentials => {
        localStorage.setItem('jellyfin_credentials', credentials)
        localStorage.setItem('oriel-settings', JSON.stringify({ pageTurn: 'none' }))
    }, credentials)

    let page = await open(context)
    const bare = await measure(page)
    await page.close()

    if (browserName === 'chromium') {
        page = await context.newPage()
        // The frames of the trace are told apart by this page's own frame, which is there before the book opens in it.
        await page.goto(`${base}/Oriel/licenses.html`)
        onceByPaginator(await laidOut(page, async () => {
            await page.goto(`${base}/Oriel/?id=${itemId}`)
            await page.waitForSelector('body[data-state="rendered"]', { timeout: 60_000 }).catch(() => fail('the reader did not render the long book'))
            // Long enough for a layout the browser does by itself, in the next frames.
            await pause(1_000)
        }), 'opening the book')
        await page.keyboard.press('Escape')
        await goTo(page, START)
        await page.evaluate(() => { const { renderer } = document.querySelector('foliate-view'); return renderer.goTo({ index: renderer.getContents()[0].index, anchor: () => 1 }) })
        const shown = () => page.evaluate(() => document.querySelector('foliate-view').renderer.getContents()[0]?.index)
        onceByPaginator(await laidOut(page, async () => {
            await page.keyboard.press('ArrowRight')
            await until(async () => await shown() === START, 'the right arrow key on the last page of a chapter did not turn into the next')
            // As above.
            await pause(1_000)
        }), 'turning into a chapter')
        pass('opening the book and turning into a chapter lay the section out in full once, asked for by the paginator')
        await page.close()
    }

    const imported = await call('/Oriel/Import', mine, { method: 'POST', body: JSON.stringify(marks()) })
    const kept = await Promise.all(['Bookmarks', 'Highlights'].map(async kind => (await call(`/Oriel/${kind}/${itemId}`, mine)).length))
    if (kept.join() !== `${BOOKMARKS},${HIGHLIGHTS}`) fail(`the import left ${kept.join(' bookmarks and ')} highlights: ${JSON.stringify(imported)}`)

    page = await open(context)
    await goTo(page, BOOKMARKED)
    await until(() => bookmarkShown(page), 'the first page of a chapter with bookmarks shows none', 120_000)
    const drawn = () => page.evaluate(() => document.querySelector('foliate-view').renderer.getContents()[0].overlayer.element.querySelectorAll('g[data-colour]').length)
    const allDrawn = () => until(async () => await drawn() === HIGHLIGHTS / CHAPTERS,
        async () => `the chapter shown has ${await drawn()} highlights drawn, expected ${HIGHLIGHTS / CHAPTERS}`, 120_000)
    await allDrawn()
    const marked = await measure(page)
    if (await bookmarkShown(page)) fail('a page in a chapter with no bookmarks shows one')
    await allDrawn()

    const [bareMean, markedMean] = [middleMean(bare), middleMean(marked)]
    const ratio = markedMean / bareMean
    const times = all => `mean of the middle half ${middleMean(all).toFixed(2)} ms, median ${median(all).toFixed(1)}, longest ${Math.max(...all).toFixed(1)}`
    const said = `of ${TURNS} turns, with nothing marked the ${times(bare)}; with ${BOOKMARKS} bookmarks and ${HIGHLIGHTS} highlights the ${times(marked)}: ${ratio.toFixed(2)} times as long`
    if (!(ratio <= BOUND)) fail(`${said}, expected at most ${BOUND}`)
    pass(`${said}, at most ${BOUND}`)
} catch (error) {
    console.error(`FAIL: ${browserName}: ${error.message}`)
    failed = true
} finally {
    await browser.close()
    // Removing the user removes the marks.
    if (userId) await call(`/Users/${userId}`, admin, { method: 'DELETE' }).catch(error => { console.error(`FAIL: ${error.message}`); failed = true })
}
process.exit(failed ? 1 : 0)
