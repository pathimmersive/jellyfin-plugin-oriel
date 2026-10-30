// Checks Contents in the browser named by ORIEL_BROWSER: webkit at iPhone size
// with touch, or chromium at desktop size with a mouse. With the controls
// shown, Contents sits in the header before More. It opens a panel titled with
// the book's title that lists the test EPUB's chapters and its nested entry in
// order, indented, with rising percents and the chapter being read marked.
// Escape, Close and (on a phone) the dimmed page close it and leave the book
// where it is. Choosing another chapter goes there, closes the panel and the
// controls, and saves the place to Oriel and Jellyfin. On the test comic, whose
// pages are a scaled fixed layout, a tap in the middle opens the controls and
// Contents lists its pages. The test PDF, which has no outline, says it has no
// contents. Configured by environment: ORIEL_BASE (server URL including any
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
const credentials = JSON.stringify({
    Servers: [{
        Id: env('ORIEL_SERVER_ID'),
        AccessToken: env('ORIEL_TOKEN'),
        UserId: env('ORIEL_USER_ID'),
        ManualAddress: new URL(base).origin,
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

const ENTRIES = ['Chapter One', 'Chapter Two', 'Chapter Two, Second Half', 'Chapter Three', 'Chapter Four']
// First lines of the chapters the check can choose.
const FIRST_LINES = {
    'Chapter Three': 'Oriel smoke chapter three starts here.',
    'Chapter Four': 'Oriel smoke chapter four starts here.',
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

// The book renders in iframes, so read every frame.
const frameText = async page => (await Promise.all(page.frames().map(frame =>
    frame.evaluate(() => document.body?.innerText ?? '').catch(() => '')))).join('\n')

const open = async (context, id) => {
    const page = await context.newPage()
    await page.goto(`${base}/Oriel/?id=${id}`)
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 })
        .catch(() => fail(`the reader did not render ${id}`))
    await pause(1000)
    return page
}

// Shows the controls and opens Contents.
const openContents = async page => {
    if (!await page.locator('#controls header').isVisible()) await press(page, 0.5)
    const button = page.getByRole('button', { name: 'Contents' })
    if (!await button.isVisible()) fail('the controls have no Contents button')
    await button.click()
    await pause(400)
    const panel = page.locator('#contents')
    if (!await panel.isVisible()) fail('Contents did not open')
    return panel
}

const browser = await setup.engine.launch()
let failed = false
try {
    const context = await browser.newContext(setup.context)
    await context.addInitScript(value => {
        localStorage.setItem('jellyfin_credentials', value)
    }, credentials)
    const page = await open(context, itemId)

    // The button sits in the header, before More.
    await press(page, 0.5)
    const order = await page.locator('#controls header button').evaluateAll(buttons => buttons.map(b => b.getAttribute('aria-label')))
    if (order.indexOf('Contents') < 0 || order.indexOf('Contents') > order.indexOf('More')) fail(`the header's buttons are ${order.join(', ')}`)
    const size = await page.getByRole('button', { name: 'Contents' }).boundingBox()
    if (!size || size.width < 44 || size.height < 44) fail('the Contents button is under 44 px')
    pass(`the header's buttons are ${order.join(', ')}`)

    // The panel: title, entries in order, indented, percents, the current one.
    const before = await position(page)
    let panel = await openContents(page)
    const title = (await panel.locator('h2').innerText()).trim()
    if (title !== 'Oriel Smoke Book') fail(`Contents is titled '${title}'`)
    const rows = await panel.locator('li a').evaluateAll(links => links.map(a => ({
        label: a.querySelector('.label')?.textContent?.trim(),
        percent: a.querySelector('.where')?.textContent?.trim(),
        indent: parseFloat(getComputedStyle(a).paddingLeft),
        current: a.getAttribute('aria-current'),
    })))
    const labels = rows.map(row => row.label)
    if (labels.join('|') !== ENTRIES.join('|')) fail(`Contents lists ${labels.join(', ')}`)
    const percents = rows.map(row => parseInt(row.percent, 10))
    if (rows.some(row => !/^\d{1,3}%$/.test(row.percent)) || percents[0] !== 0 || percents.some((p, i) => i > 0 && p < percents[i - 1])) {
        fail(`the entries' percents are ${rows.map(row => row.percent).join(', ')}`)
    }
    if (!(rows[2].indent > rows[1].indent) || rows[1].indent !== rows[0].indent) fail(`the entries' indents are ${rows.map(row => row.indent).join(', ')}`)
    const current = rows.filter(row => row.current === 'true')
    if (current.length !== 1) fail(`${current.length} entries are marked as being read`)
    pass(`Contents, titled '${title}', lists ${labels.join(', ')} at ${rows.map(row => row.percent).join(', ')}, the nested entry indented, '${current[0].label}' marked`)

    // Escape, Close and the dimmed page close it without moving the book.
    await page.keyboard.press('Escape')
    await pause(300)
    if (await panel.isVisible()) fail('Escape did not close Contents')
    panel = await openContents(page)
    await panel.getByRole('button', { name: 'Close' }).click()
    await pause(300)
    if (await panel.isVisible()) fail('Close did not close Contents')
    if (setup.touch) {
        panel = await openContents(page)
        await page.locator('#contents-backdrop').click({ position: { x: 20, y: 60 } })
        await pause(300)
        if (await panel.isVisible()) fail('a tap on the dimmed page did not close Contents')
    }
    if (await position(page) !== before) fail('closing Contents moved the book')
    pass(`Escape, Close${setup.touch ? ' and the dimmed page' : ''} close Contents and leave the book at ${before}`)

    // Choosing an entry goes there, closes everything, and saves the place.
    // The entry is not the one being read, so the choice is a real move: going
    // to the page already shown is not a move and saves nothing.
    const chosen = current[0].label === 'Chapter Three' ? 'Chapter Four' : 'Chapter Three'
    panel = await openContents(page)
    const stored = page.waitForRequest(request => request.method() === 'PUT' && request.url().includes(`/Oriel/Positions/${itemId}`), { timeout: 15_000 }).catch(() => null)
    const mirrored = page.waitForRequest(request => request.method() === 'POST' && request.url().includes(`/UserItems/${itemId}/UserData`), { timeout: 15_000 }).catch(() => null)
    await panel.getByRole('link', { name: new RegExp(`^${chosen}`) }).click()
    await pause(1500)
    if (await panel.isVisible()) fail(`choosing ${chosen} left Contents open`)
    if (await page.locator('#controls header').isVisible()) fail(`choosing ${chosen} left the controls shown`)
    if (!(await frameText(page)).includes(FIRST_LINES[chosen])) fail(`choosing ${chosen} does not show '${FIRST_LINES[chosen]}'`)
    if ((await page.locator('#reading-footer .chapter').innerText()).trim() !== chosen) fail(`the reading footer does not show ${chosen}`)
    if (!await stored) fail(`the move to ${chosen} was not saved to /Oriel/Positions`)
    if (!await mirrored) fail(`the move to ${chosen} was not mirrored to Jellyfin`)
    pass(`choosing ${chosen} from '${current[0].label}' shows it, closes Contents and the controls, and saves and mirrors the place`)
    await page.close()

    // The comic: a tap in the middle of a scaled page opens the controls, and
    // Contents lists its pages.
    const comic = await open(context, comicId)
    const pages = await openContents(comic)
    const count = await pages.locator('li a').count()
    if (count !== 4) fail(`Contents for the comic lists ${count} entries, expected its 4 pages`)
    pass('on the comic, a tap in the middle opens the controls, and Contents lists its 4 pages')
    await comic.close()

    // A book with no contents says so.
    const pdf = await open(context, pdfId)
    const empty = await openContents(pdf)
    const message = (await empty.innerText()).trim()
    if (!message.includes('This book has no table of contents.')) fail(`Contents for the PDF shows '${message}'`)
    if (await empty.locator('li').count() !== 0) fail('Contents for the PDF lists entries')
    pass('Contents for the PDF, which has no outline, says This book has no table of contents.')
} catch (error) {
    console.error(`FAIL: ${browserName}: ${error.message}`)
    failed = true
} finally {
    // WebKit can hang while closing; the result is already known, so stop waiting.
    await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 10_000))])
}
process.exit(failed ? 1 : 0)
