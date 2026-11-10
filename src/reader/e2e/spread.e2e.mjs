// Checks the desktop layout in Chromium at 1280x800, as the canvas's DeskRead,
// DeskControls, DeskContents and DeskText draw it: the book shows as a
// two-page spread; with the controls showing, Previous page and Next page
// arrows (48 by 96 px, 16 px from the edges, centred down the window, in the
// theme's footer colour) turn the page back and forward and leave the controls
// showing, and Previous page is hidden at the book's first page and Next page
// at its last; Contents (and
// its Highlights tab) and Preferences open as a 440 px panel at the right
// between the header and the footer, with the arrows hidden and the book moved
// clear of it, and closing the panel shows the same place and the spread
// again; Full screen enters and leaves full screen.
// Configured by environment: ORIEL_BASE (server URL including any BaseUrl),
// ORIEL_SERVER_ID, ORIEL_USER_ID, ORIEL_TOKEN and ORIEL_ITEM_ID. Exits non-zero
// on the first failed check.
import { chromium } from 'playwright'
import { press } from './press.mjs'

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

const fail = message => { throw new Error(message) }
const pass = message => console.log(`PASS: chromium: ${message}`)

// The page shown, as "<section index>:<page>", and the columns a screen shows.
const shown = page => page.evaluate(() => {
    const renderer = document.querySelector('foliate-view').renderer
    const { doc, index } = renderer.getContents()[0]
    const style = doc.defaultView.getComputedStyle(doc.documentElement)
    const perScreen = Math.round(renderer.size / (parseFloat(style.columnWidth) + parseFloat(style.columnGap)))
    // The right edge of the text shown, in the window: the lines inside the
    // area the paginator shows, since the next page's lie just past it.
    const frame = doc.defaultView.frameElement.getBoundingClientRect()
    const area = renderer.getBoundingClientRect()
    const range = doc.createRange()
    range.selectNodeContents(doc.body)
    const right = Math.max(...[...range.getClientRects()]
        .filter(rect => rect.width > 0 && rect.left + frame.left >= area.left - 1 && rect.right + frame.left <= area.right + 1)
        .map(rect => rect.right + frame.left))
    return { at: `${index}:${renderer.page}`, perScreen, right }
})

// Waits until the page has come to rest: off the paginator's blank lead-in
// and unchanged for half a second from now.
const settled = async page => {
    await page.evaluate(() => { window.__orielAt = null })
    await rested(page)
}
const rested = page => page.waitForFunction(() => {
    const renderer = document.querySelector('foliate-view')?.renderer
    const at = renderer && `${renderer.getContents()[0]?.index}:${renderer.page}`
    const now = performance.now()
    if (!at || renderer.page < 1 || at !== window.__orielAt) {
        window.__orielAt = at
        window.__orielSince = now
        return false
    }
    return now - window.__orielSince >= 500
}, null, { timeout: 15_000, polling: 100 }).catch(() => fail('the page never came to rest'))

// An arrow's box, colour and name, or null when it is not shown.
const arrow = (page, which) => page.evaluate(which => {
    const button = document.querySelector(`.page-arrow.${which}`)
    if (!button?.checkVisibility()) return null
    const { left, right, top, width, height } = button.getBoundingClientRect()
    const svg = button.querySelector('svg').getBoundingClientRect()
    return {
        left, right: innerWidth - right, centre: top + height / 2 - innerHeight / 2, width, height,
        icon: Math.round(svg.width), colour: getComputedStyle(button).color, name: button.getAttribute('aria-label'),
    }
}, which)

const controlsShown = page => page.locator('#controls header').isVisible()

// Clicks an arrow and waits for the page to move from where it was, then to rest.
const turnWith = async (page, which) => {
    const from = (await shown(page)).at
    await page.click(`.page-arrow.${which}`)
    await page.waitForFunction(from => {
        const renderer = document.querySelector('foliate-view').renderer
        return `${renderer.getContents()[0]?.index}:${renderer.page}` !== from
    }, from, { timeout: 5_000 }).catch(() => fail(`${which === 'next' ? 'Next' : 'Previous'} page left the page at ${from}`))
    await settled(page)
}

const browser = await chromium.launch()
let failed = false
try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    await context.addInitScript(value => {
        localStorage.setItem('jellyfin_credentials', value)
        localStorage.setItem('oriel-hints', JSON.stringify({ first: true, scroll: true }))
    }, credentials)
    const page = await context.newPage()
    await page.goto(`${base}/Oriel/?id=${itemId}`)
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 }).catch(() => fail('the reader did not render the book'))
    await settled(page)

    // From the book's first page.
    await page.evaluate(() => document.querySelector('foliate-view').goToFraction(0))
    await settled(page)
    const first = await shown(page)
    if (first.perScreen !== 2) fail(`at 1280x800 the book shows ${first.perScreen} column(s), not a two-page spread`)
    pass(`at 1280x800 the book shows as a two-page spread (${first.at})`)

    // The arrows come with the controls.
    if (await arrow(page, 'next')) fail('Next page shows while the controls are hidden')
    await press(page, 0.5)
    if (!await controlsShown(page)) fail('a click in the middle did not show the controls')
    const footer = await page.evaluate(() => getComputedStyle(document.getElementById('reading-footer')).color)
    const nextArrow = await arrow(page, 'next')
    if (!nextArrow) fail('Next page does not show with the controls')
    const sized = box => box.width === 48 && box.height === 96 && box.icon === 36 && Math.abs(box.centre) <= 1
    if (!sized(nextArrow) || Math.abs(nextArrow.right - 16) > 0.5) fail(`Next page is not 48x96 px, 16 px from the right and centred: ${JSON.stringify(nextArrow)}`)
    if (nextArrow.colour !== footer) fail(`Next page is ${nextArrow.colour}, not the theme's footer colour ${footer}`)
    if (nextArrow.name !== 'Next page') fail(`the right arrow is named '${nextArrow.name}'`)
    if (await arrow(page, 'previous')) fail(`Previous page shows at the book's first page (${first.at})`)
    pass(`with the controls, Next page shows 48x96 px, 16 px from the right edge and centred, in ${footer}; at the first page Previous page is hidden`)

    // They turn the page and leave the controls showing.
    await turnWith(page, 'next')
    const turned = await shown(page)
    if (!await controlsShown(page)) fail('Next page hid the controls')
    const previousArrow = await arrow(page, 'previous')
    if (!previousArrow || !sized(previousArrow) || Math.abs(previousArrow.left - 16) > 0.5) fail(`Previous page is not 48x96 px, 16 px from the left and centred once past the first page: ${JSON.stringify(previousArrow)}`)
    await turnWith(page, 'previous')
    const back = await shown(page)
    if (back.at !== first.at) fail(`Previous page went to ${back.at}, not back to ${first.at}`)
    if (!await controlsShown(page)) fail('Previous page hid the controls')
    pass(`Next page turned from ${first.at} to ${turned.at} and Previous page back, the controls left showing`)

    // A panel opens at the right, the arrows hide and the book moves clear of
    // it; closing it shows the same place as a spread again.
    await turnWith(page, 'next')
    const before = await shown(page)
    const panels = [
        ['Contents', '#contents', async () => page.click('#controls header button[aria-label="Contents"]'), async () => page.click('#contents button[aria-label="Close"]')],
        ['Highlights', '#contents', async () => {
            await page.click('#controls header button[aria-label="Contents"]')
            await page.click('#tab-highlights')
        }, async () => page.click('#contents button[aria-label="Close"]')],
        ['Preferences', '#prefs', async () => page.click('#controls header button[aria-label="Preferences"]'), async () => page.click('#prefs button[aria-label="Close"]')],
    ]
    for (const [name, selector, open, close] of panels) {
        await open()
        await page.waitForSelector(`${selector}:not([hidden])`, { timeout: 5_000 }).catch(() => fail(`${name} did not open`))
        await settled(page)
        const panel = await page.evaluate(selector => {
            const { left, right, top, bottom, width } = document.querySelector(selector).getBoundingClientRect()
            const header = document.querySelector('#controls header').getBoundingClientRect()
            const footer = document.querySelector('#controls footer').getBoundingClientRect()
            return { left, right, top, bottom, width, headerBottom: header.bottom, footerTop: footer.top, innerWidth }
        }, selector)
        if (Math.round(panel.width) !== 440 || Math.round(panel.right) !== panel.innerWidth) fail(`${name} is not a 440 px panel at the right: ${JSON.stringify(panel)}`)
        if (panel.top < panel.headerBottom - 1 || panel.bottom > panel.footerTop + 1) fail(`${name} is not between the header and the footer: ${JSON.stringify(panel)}`)
        if (await arrow(page, 'next') || await arrow(page, 'previous')) fail(`the arrows show while ${name} is open`)
        const beside = await shown(page)
        if (beside.right > panel.left - 19) fail(`with ${name} open the book's text reaches ${Math.round(beside.right)} px, under the panel at ${Math.round(panel.left)} px`)
        if (!await page.evaluate(() => document.querySelector('foliate-view').renderer.getContents()[0].doc.body.innerText.trim().length > 0)) fail(`with ${name} open no text shows`)
        await close()
        await page.waitForSelector(`${selector}`, { state: 'hidden', timeout: 5_000 }).catch(() => fail(`${name} did not close`))
        await settled(page)
        const after = await shown(page)
        if (after.at !== before.at || after.perScreen !== 2) fail(`after closing ${name} the book shows ${after.at} in ${after.perScreen} column(s), not ${before.at} as a spread`)
        pass(`${name} opens as a 440 px panel at the right between the header and footer, the arrows hidden and the text clear of it (to ${Math.round(beside.right)} px, ${beside.perScreen} column(s)); closing it shows ${after.at} as a spread again`)
    }

    // At the book's last page Next page is hidden: turn with it until it goes.
    await page.evaluate(() => document.querySelector('foliate-view').goToFraction(0.99))
    await settled(page)
    if (!await controlsShown(page)) await press(page, 0.5)
    let turns = 0
    while (await arrow(page, 'next') && turns < 20) {
        await turnWith(page, 'next')
        turns += 1
    }
    const last = await shown(page)
    const atEnd = await page.evaluate(() => document.querySelector('foliate-view').renderer.atEnd)
    if (await arrow(page, 'next') || !atEnd) fail(`Next page did not hide at the book's last page (${last.at}, at the end: ${atEnd})`)
    if (!await arrow(page, 'previous')) fail(`Previous page is hidden at the book's last page (${last.at})`)
    pass(`at the book's last page (${last.at}) Next page is hidden and Previous page shows`)

    // Full screen, from the controls' footer.
    if (!await controlsShown(page)) await press(page, 0.5)
    const enter = page.locator('#controls footer button[aria-label="Full screen"]')
    if (!await enter.isVisible()) fail('the footer has no Full screen button')
    await enter.click()
    await page.waitForFunction(() => document.fullscreenElement !== null, null, { timeout: 5_000 }).catch(() => fail('Full screen did not go full screen'))
    const leave = page.locator('#controls footer button[aria-label="Leave full screen"]')
    if (!await leave.isVisible()) fail('in full screen the button does not read Leave full screen')
    await leave.click()
    await page.waitForFunction(() => document.fullscreenElement === null, null, { timeout: 5_000 }).catch(() => fail('Leave full screen did not leave full screen'))
    pass('Full screen in the footer goes full screen, and Leave full screen leaves it')
} catch (error) {
    console.error(`FAIL: chromium: ${error.message}`)
    failed = true
} finally {
    await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 10_000))])
}
process.exit(failed ? 1 : 0)
