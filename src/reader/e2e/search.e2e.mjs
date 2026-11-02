// Checks Search in this book in the browser named by ORIEL_BROWSER: webkit at
// iPhone size with touch, or chromium at desktop size with a mouse. On the test
// EPUB, More's first item is Search in this book; choosing it closes More and
// opens the search sheet with its field focused. A search lists matches under
// their chapter names, each with the match marked, ignoring case and accents and
// matching inside words. Choosing a match goes to its page, closes the sheet,
// marks the match on the page and saves the place. Reopening keeps the search; a
// misspelling shows the no-matches text; clearing the field clears the results
// and the marks. More leaves search out for the test comic and PDF. Nothing is
// requested from another host. Configured by environment: ORIEL_BASE (server URL
// including any BaseUrl), ORIEL_SERVER_ID, ORIEL_USER_ID, ORIEL_TOKEN,
// ORIEL_ITEM_ID (the test EPUB), ORIEL_CBZ_ID, ORIEL_PDF_ID and ORIEL_BROWSER.
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

// Presses a button or link as this screen's reader would: a tap on a touch screen, else a click.
const use = locator => setup.touch ? locator.tap() : locator.click()

const CHAPTERS = ['Chapter One', 'Chapter Two', 'Chapter Three', 'Chapter Four']

const open = async (context, id) => {
    const page = await context.newPage()
    await page.goto(`${base}/Oriel/?id=${id}`)
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 })
        .catch(() => fail(`the reader did not render ${id}`))
    await pause(1000)
    return page
}

// Shows the controls and opens More; returns the names of More's items.
const openMore = async page => {
    if (!await page.locator('#controls header').isVisible()) {
        if (!await pressAt(page, 0.5, setup.touch)) fail('no frame shows the page to tap')
        await pause(600)
    }
    await use(page.getByRole('button', { name: 'More' }))
    await pause(300)
    return (await page.locator('#more a, #more button').allInnerTexts()).map(text => text.trim())
}

const sheet = page => page.getByRole('region', { name: 'Search in this book' })
const field = page => sheet(page).getByRole('searchbox', { name: 'Search in this book' })

// Searches for `query` and waits for the search to end; returns the groups shown.
const search = async (page, query) => {
    await field(page).fill(query)
    await field(page).press('Enter')
    await page.waitForFunction(() => {
        const searching = document.querySelector('#search .searching')
        return !searching || searching.hidden
    }, null, { timeout: 30_000 }).catch(() => fail(`the search for '${query}' did not end`))
    await pause(300)
    return groups(page)
}

// The results: each chapter's name and its matches' marked text and full text.
const groups = page => sheet(page).locator('.results .group').evaluateAll(nodes => nodes.map(node => ({
    chapter: node.querySelector('.chapter')?.textContent?.trim() ?? '',
    marks: [...node.querySelectorAll('li mark')].map(mark => mark.textContent),
    texts: [...node.querySelectorAll('li a')].map(a => a.textContent.trim()),
})))

// The section shown, and how many matches are marked on its page.
const shown = page => page.evaluate(() => {
    const contents = document.querySelector('foliate-view').renderer.getContents()[0]
    return { index: contents?.index, marks: contents?.overlayer?.element.querySelectorAll('rect').length ?? 0 }
})

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

    // More's first item opens the sheet, with its field focused.
    const items = await openMore(page)
    if (items[0] !== 'Search in this book') fail(`More lists ${items.join(', ')}`)
    await use(page.locator('#more').getByText('Search in this book', { exact: true }))
    await pause(500)
    if (await page.locator('#more').isVisible()) fail('Search in this book left More open')
    if (!await sheet(page).isVisible()) fail('Search in this book opened no sheet titled Search in this book')
    const heading = (await sheet(page).locator('h2').innerText()).trim()
    if (heading !== 'Search in this book') fail(`the sheet is titled '${heading}'`)
    if (!await field(page).evaluate(input => input === document.activeElement)) fail('the search field does not have focus')
    pass(`More lists ${items.join(', ')}, and Search in this book opens its sheet with the field focused`)

    // Case and accents are ignored: every chapter's 'smoke'.
    let found = await search(page, 'SMOKÉ')
    if (found.map(group => group.chapter).join('|') !== CHAPTERS.join('|')) fail(`'SMOKÉ' found matches under ${found.map(group => group.chapter).join(', ')}`)
    if (found.some(group => group.marks.join('|') !== 'smoke')) fail(`'SMOKÉ' marked ${found.map(group => group.marks.join('/')).join(', ')}`)
    const colour = await sheet(page).locator('.results mark').first().evaluate(mark => getComputedStyle(mark).backgroundColor)
    if (colour !== 'rgba(0, 164, 220, 0.35)') fail(`the match is marked in ${colour}`)
    pass(`'SMOKÉ' finds 'smoke' once under each of ${CHAPTERS.join(', ')}, marked in the selection colour`)

    // Inside words: a chapter's heading and its first line. The chapter is
    // not the one shown, so going there is a move: Three, or else Four.
    const before = await shown(page)
    const [chapter, index, query] = before.index === 2 ? ['Chapter Four', 3, 'hapter fou'] : ['Chapter Three', 2, 'hapter thre']
    const line = `chapter ${chapter.split(' ')[1].toLowerCase()} starts here`
    found = await search(page, query)
    if (found.length !== 1 || found[0].chapter !== chapter || found[0].marks.length !== 2) fail(`'${query}' found ${JSON.stringify(found)}`)
    const target = found[0].texts.findIndex(text => text.includes(line))
    if (target < 0) fail(`no match for '${query}' shows its surrounding text: ${found[0].texts.join(' / ')}`)
    pass(`'${query}' finds ${found[0].marks.join(' and ')} under ${chapter}, with the text around them`)

    // Choosing a match goes there, closes the sheet, marks it, and saves the place.
    const stored = page.waitForRequest(request => request.method() === 'PUT' && request.url().includes(`/Oriel/Positions/${itemId}`), { timeout: 15_000 }).catch(() => null)
    await use(sheet(page).locator('.results li a').nth(target))
    await pause(1500)
    if (await sheet(page).isVisible()) fail('choosing a match left the sheet open')
    const after = await shown(page)
    if (after.index !== index) fail(`choosing the match shows section ${after.index}, not ${chapter}`)
    if (after.marks < 1) fail('no match is marked on the page')
    if ((await page.locator('#reading-footer .chapter').innerText()).trim() !== chapter) fail(`the reading footer does not show ${chapter}`)
    if (!await stored) fail('the move to the match was not saved to /Oriel/Positions')
    pass(`choosing a match goes to ${chapter}, closes the sheet, marks ${after.marks} match${after.marks === 1 ? '' : 'es'} on the page and saves the place`)

    // Reopening keeps the search.
    await openMore(page)
    await use(page.locator('#more').getByText('Search in this book', { exact: true }))
    await pause(500)
    if (await field(page).inputValue() !== query) fail(`the reopened sheet's field holds '${await field(page).inputValue()}'`)
    if ((await groups(page)).length !== 1) fail('the reopened sheet lost its results')
    pass('reopening the sheet keeps the last search and its results')

    // A misspelling says so.
    found = await search(page, 'Oriel smokk')
    if (found.length) fail(`'Oriel smokk' found ${JSON.stringify(found)}`)
    const empty = (await sheet(page).locator('.no-matches').innerText()).replace(/\s+/g, ' ').trim()
    if (empty !== 'No matches for “Oriel smokk” in this book. Check the spelling, or search for fewer words.') fail(`a search with no matches shows '${empty}'`)
    pass(`a search with no matches shows '${empty}'`)

    // Clearing the field clears the results and the marks.
    await search(page, query)
    await field(page).fill('')
    await pause(500)
    if ((await groups(page)).length || await sheet(page).locator('.no-matches').count()) fail('clearing the field left results')
    const cleared = await shown(page)
    if (cleared.marks !== 0) fail(`clearing the field left ${cleared.marks} marks on the page`)
    await page.keyboard.press('Escape')
    await pause(300)
    if (await sheet(page).isVisible()) fail('Escape did not close the sheet')
    pass('clearing the field clears the results and the marks, and Escape closes the sheet')
    await page.close()

    // Comics and PDFs leave search out.
    for (const [name, id] of [['comic', comicId], ['PDF', pdfId]]) {
        const other = await open(context, id)
        const listed = await openMore(other)
        if (listed.includes('Search in this book')) fail(`More offers Search in this book for the ${name}`)
        await other.close()
    }
    pass('More leaves Search in this book out for the comic and the PDF')

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
