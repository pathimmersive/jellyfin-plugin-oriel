// Checks pages in the browser named by ORIEL_BROWSER: webkit at iPhone size
// with touch, or chromium at desktop size with a mouse. On the test EPUB both
// footers show the pages left in the chapter, as many as the columns laid out
// after the last one on screen, up to the chapter's end: the end of the section,
// or the nested contents entry halfway through Chapter Two. Turning forward
// lowers it by the pages turned. With Pages chosen in Preferences the footers
// show page / total once the book is counted; the total is every section's
// columns, the last page shows the total, and Contents shows each entry's start
// page. A larger size counts again to a larger total. After a reload Pages is
// still chosen and the count is reused. The test comic and PDF show the percent
// only. Nothing is requested from another host. Configured by environment:
// ORIEL_BASE (server URL including any BaseUrl), ORIEL_SERVER_ID,
// ORIEL_USER_ID, ORIEL_TOKEN, ORIEL_ITEM_ID (the test EPUB), ORIEL_CBZ_ID (the
// test comic), ORIEL_PDF_ID (the test PDF) and ORIEL_BROWSER. Exits non-zero on
// the first failed check.
import { chromium, devices, webkit } from 'playwright'
import { press as pressAt } from './press.mjs'
import { until, watchMove } from './wait.mjs'

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

const open = async (context, id) => {
    const page = await context.newPage()
    await page.goto(`${base}/Oriel/?id=${id}`)
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 })
        .catch(() => fail(`the reader did not render ${id}`))
    await until(async () => (await page.locator('#reading-footer .progress').innerText()).trim(), `the reader rendered ${id} but its footer shows no progress`)
    return page
}

// The section shown, laid out as the paginator laid it out: columns per
// screen, its columns, the first and last shown, and, in Chapter Two, the
// last column of the chapter's first half (the nested entry's column, or the
// one before when the entry starts at the top of its column).
const laidOut = page => page.evaluate(() => {
    const renderer = document.querySelector('foliate-view').renderer
    const { doc, index } = renderer.getContents()[0]
    const root = doc.documentElement
    const style = doc.defaultView.getComputedStyle(root)
    const perScreen = Math.round(renderer.size / (parseFloat(style.columnWidth) + parseFloat(style.columnGap)))
    const slot = renderer.size / perScreen
    const rootRect = root.getBoundingClientRect()
    const range = doc.createRange()
    range.selectNodeContents(doc.body)
    const columns = Math.max(1, Math.ceil((range.getBoundingClientRect().right - rootRect.left) / slot - 0.01))
    const first = (renderer.page - 1) * perScreen
    const nested = doc.getElementById('second-half')
    let half = null
    if (nested) {
        const rect = nested.getBoundingClientRect()
        const column = Math.floor((rect.left - rootRect.left) / slot)
        half = rect.top - rootRect.top > 1 ? column : column - 1
    }
    return { index, perScreen, columns, first, last: Math.min(columns - 1, first + perScreen - 1), half }
})

// The pages-left mark in a footer: its number and its name.
const left = async (page, footer = '#reading-footer') => {
    const mark = page.locator(`${footer} .left`)
    if (!await mark.count()) return null
    return { text: (await mark.innerText()).trim(), name: await mark.getAttribute('aria-label'), shown: await mark.isVisible() }
}

const progress = page => page.locator('#reading-footer .progress').innerText().then(text => text.trim())

const leftName = n => n === 1 ? '1 page left in this chapter' : `${n} pages left in this chapter`

// The pages-left mark against the layout shown, with what is wrong with it, if anything.
const leftWrong = async (page, end, what) => {
    const shown = await laidOut(page)
    const want = Math.max(0, end(shown) - shown.last)
    const mark = await left(page)
    if (!mark) return { shown, want, wrong: 'the reading footer shows no pages left in the chapter' }
    if (mark.text !== String(want) || mark.name !== leftName(want)) return { shown, want, wrong: `${what}: the footer shows '${mark.text}' (${mark.name}), expected ${want} (${leftName(want)})` }
    return { shown, want, wrong: null }
}

const checkLeft = async (page, end, what) => {
    const { shown, want } = await until(async () => { const now = await leftWrong(page, end, what); return !now.wrong && now },
        async () => (await leftWrong(page, end, what)).wrong ?? `${what}: the footer did not settle`)
    return { shown, want }
}

const turn = async page => {
    const before = await laidOut(page)
    const turned = await watchMove(page, 'ArrowRight did not turn the page')
    await page.keyboard.press('ArrowRight')
    await turned()
    await until(async () => { const now = await laidOut(page); return now.index !== before.index || now.first !== before.first }, 'ArrowRight did not turn the page')
}

const goTo = async (page, script, arg) => {
    const moved = await watchMove(page, 'the book did not move where it was sent')
    await page.evaluate(script, arg)
    await moved()
}

const controlsShown = page => page.locator('#controls header').isVisible()

// A tap in the middle, which shows the controls or hides them.
const press = async (page, share) => {
    const was = await controlsShown(page)
    if (!await pressAt(page, share, setup.touch)) fail('no frame shows the page to tap')
    await until(async () => await controlsShown(page) !== was, was ? 'a tap in the middle did not hide the controls' : 'a tap in the middle did not show the controls')
}

const openPrefs = async page => {
    if (!await controlsShown(page)) await press(page, 0.5)
    await page.getByRole('button', { name: 'Preferences' }).click()
    const panel = page.locator('#prefs')
    await until(() => panel.isVisible(), 'Preferences did not open')
    return panel
}

const closePrefs = async page => {
    await page.keyboard.press('Escape')
    await until(async () => !await page.locator('#prefs').isVisible(), 'Escape did not close Preferences')
}

// Waits for the footer to show page / total; gives the two numbers and the time taken since `started`.
const counted = async (page, timeout = 60_000, started = Date.now()) => {
    const match = await until(async () => /^(\d+)\s*\/\s*(\d+)$/.exec(await progress(page)),
        async () => `the footer still shows '${await progress(page)}' after ${timeout / 1000} s, not page / total`, timeout - (Date.now() - started))
    return { page: Number(match[1]), total: Number(match[2]), ms: Date.now() - started }
}

// Every section's columns as the reader lays them out on screen, shown one at
// a time, and the page each starts on; the reader is left at the book's start.
const layOutAll = async page => {
    const sections = await page.evaluate(() => document.querySelector('foliate-view').book.sections.length)
    let sum = 0
    const starts = []
    for (let index = 0; index < sections; index++) {
        await goTo(page, i => document.querySelector('foliate-view').goTo(i), index)
        const section = await laidOut(page)
        if (section.index !== index) fail(`could not show section ${index}`)
        starts.push(sum + 1)
        sum += section.columns
    }
    return { sum, starts }
}

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
    const page = await open(context, itemId)

    // Pages left in Chapter One, at its start, in both footers.
    await goTo(page, () => document.querySelector('foliate-view').goTo(document.querySelector('foliate-view').book.toc[0].href))
    let { shown, want } = await checkLeft(page, s => s.columns - 1, 'at the start of Chapter One')
    if (!/%$/.test(await progress(page))) fail(`with Percentage the footer shows '${await progress(page)}'`)
    await press(page, 0.5)
    const controlsMark = await left(page, '#controls footer')
    if (!controlsMark?.shown || controlsMark.text !== String(want)) fail(`the controls' footer shows ${JSON.stringify(controlsMark)} pages left, expected ${want}`)
    await press(page, 0.5)
    pass(`both footers show ${want} pages left at the start of Chapter One (${shown.columns} columns, ${shown.perScreen} a screen)`)

    // Turning forward lowers it by the pages turned.
    if (want < shown.perScreen) fail(`Chapter One has too few pages (${want} left) to check a turn`)
    await turn(page)
    const after = await checkLeft(page, s => s.columns - 1, 'after a turn in Chapter One')
    if (after.want !== want - shown.perScreen) fail(`a turn took the pages left from ${want} to ${after.want}, expected ${want - shown.perScreen}`)
    pass(`a page turn lowers the pages left from ${want} to ${after.want}`)

    // Chapter Two's first half ends at its nested entry, not the section's end.
    await goTo(page, () => document.querySelector('foliate-view').goTo(document.querySelector('foliate-view').book.toc[1].href))
    ;({ shown, want } = await checkLeft(page, s => s.half ?? -1, 'at the start of Chapter Two'))
    if (shown.half === null || shown.half >= shown.columns - 1) fail('the nested entry was not found partway through Chapter Two')
    pass(`Chapter Two counts ${want} pages left to its nested entry, not ${shown.columns - 1 - shown.last} to the section's end`)

    // Pages: page / total once counted, every section's columns.
    let panel = await openPrefs(page)
    const pagesRadio = panel.getByRole('radio', { name: 'Pages', exact: true })
    if (!await pagesRadio.isVisible()) fail('Preferences has no Progress choice of Pages')
    if (await panel.getByRole('radio', { name: 'Percentage', exact: true }).getAttribute('aria-checked') !== 'true') fail('Percentage is not chosen at first')
    const chosen = Date.now()
    await pagesRadio.click()
    await until(async () => await pagesRadio.getAttribute('aria-checked') === 'true', 'Pages is not marked as chosen')
    await closePrefs(page)
    const first = await counted(page, 60_000, chosen)
    console.log(`INFO: ${browserName}: the test book was counted within ${first.ms} ms of choosing Pages`)
    const { sum, starts } = await layOutAll(page)
    // Chromium can count the documents alive once garbage is collected: showing every section a
    // second time must add none, as a section left behind is let go.
    if (browserName === 'chromium') {
        const cdp = await page.context().newCDPSession(page)
        await cdp.send('HeapProfiler.enable')
        const alive = async () => {
            for (let i = 0; i < 3; i++) await cdp.send('HeapProfiler.collectGarbage')
            return (await cdp.send('Memory.getDOMCounters')).documents
        }
        const once = await alive()
        await layOutAll(page)
        const twice = await alive()
        await cdp.detach()
        if (twice > once) fail(`showing all ${starts.length} sections again left ${twice} documents alive, up from ${once}: sections already left are kept`)
        pass(`showing all ${starts.length} sections again keeps ${twice} documents alive, as before`)
    }
    const atLast = await counted(page, 5000)
    if (atLast.total !== sum) fail(`the footer's total is ${atLast.total}, but the sections lay out ${sum} columns`)
    await goTo(page, () => document.querySelector('foliate-view').goToFraction(1))
    const end = await laidOut(page)
    const lastPage = await counted(page, 5000)
    if (lastPage.page + end.last - end.first !== sum) fail(`the book's last screen shows page ${lastPage.page} with ${end.last - end.first + 1} on screen, expected it to reach ${sum}`)
    pass(`Pages shows page / total, ${sum} pages in all; the last screen reaches page ${sum}`)

    // Contents shows each entry's start page.
    if (!await controlsShown(page)) await press(page, 0.5)
    await page.getByRole('button', { name: 'Contents' }).click()
    await until(async () => await page.locator('#contents').isVisible() && await page.locator('#contents .where').count(), 'Contents did not open with its entries')
    const where = await page.locator('#contents .where').allInnerTexts()
    const numbers = where.map(text => Number(text.trim()))
    if (numbers.some(Number.isNaN) || numbers[0] !== 1 || numbers.some((n, i) => i && n < numbers[i - 1])) fail(`Contents shows ${where.join(', ')}, expected rising page numbers from 1`)
    const chapterStarts = [numbers[0], numbers[1], numbers[3], numbers[4]]
    if (chapterStarts.join() !== starts.join()) fail(`Contents puts the chapters at pages ${chapterStarts.join(', ')}, the sections start at ${starts.join(', ')}`)
    await page.keyboard.press('Escape')
    await until(async () => !await page.locator('#contents').isVisible(), 'Escape did not close Contents')
    pass(`Contents shows start pages ${numbers.join(', ')}`)

    // A larger size counts again, to more pages.
    panel = await openPrefs(page)
    const size = () => page.evaluate(() => JSON.parse(localStorage.getItem('oriel-settings') ?? '{}').size ?? null)
    for (let i = 0; i < 4; i++) {
        const was = await size()
        await panel.getByRole('button', { name: 'More size', exact: true }).click()
        await until(async () => await size() !== was, `More size press ${i + 1} did not change the size`)
    }
    await closePrefs(page)
    const larger = await counted(page)
    if (larger.total <= sum) fail(`four sizes up the book counts ${larger.total} pages, expected more than ${sum}`)
    const largerLaidOut = await layOutAll(page)
    if (larger.total !== largerLaidOut.sum) fail(`four sizes up the footer's total is ${larger.total}, but the sections lay out ${largerLaidOut.sum} columns`)
    pass(`four sizes up the book counts again to ${larger.total} pages, as laid out`)

    // Kept on this device, and the count reused.
    await page.reload()
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 })
    const reused = await counted(page, 1500)
    if (reused.total !== larger.total) fail(`after a reload the total is ${reused.total}, expected ${larger.total}`)
    const reloadedLaidOut = await layOutAll(page)
    if (reloadedLaidOut.sum !== reused.total) fail(`after a reload the sections lay out ${reloadedLaidOut.sum} columns, but the reused count says ${reused.total}`)
    pass(`after a reload Pages is still chosen and the count of ${reused.total} is reused`)
    await page.close()

    // Comics and PDFs: the percent only.
    for (const [name, id] of [['comic', comicId], ['PDF', pdfId]]) {
        const fixed = await open(context, id)
        const text = await progress(fixed)
        if (!/^\d+%$/.test(text)) fail(`the ${name}'s footer shows '${text}', expected the percent only`)
        const mark = await left(fixed)
        if (mark?.shown) fail(`the ${name}'s footer shows ${mark.text} pages left`)
        pass(`the ${name}'s footer shows ${text} and no pages left`)
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
