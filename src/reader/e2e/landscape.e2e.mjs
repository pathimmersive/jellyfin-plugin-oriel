// Checks a phone in landscape in WebKit at 844x390 with touch, as the canvas's
// LandRead, LandControls and LandPrefs draw it: the book shows as one centred
// column at least 122 px from each side, with the phone's top margin, and the
// reading footer lines up with it; the controls are the phone's header and
// footer, with no arrows at the edges; Contents and Preferences open over the
// right half of the screen, its full height, over the dimmed page, and closing
// them (a tap on the dimmed page for Preferences) leaves the place unchanged;
// turning from portrait to landscape and back keeps the chapter on screen.
// Playwright draws no notch, so the safe-area insets are 0 here and the
// 122 px margins stand in for them.
// Configured by environment: ORIEL_BASE (server URL including any BaseUrl),
// ORIEL_SERVER_ID, ORIEL_USER_ID, ORIEL_TOKEN and ORIEL_ITEM_ID. Exits non-zero
// on the first failed check.
import { devices, webkit } from 'playwright'
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
const pass = message => console.log(`PASS: webkit: ${message}`)
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

const PORTRAIT = { width: 390, height: 844 }
const LANDSCAPE = { width: 844, height: 390 }

// The page shown, as "<section index>:<page>", the columns a screen shows,
// and the left, right and top edges of the text shown, in the window.
const shown = page => page.evaluate(() => {
    const renderer = document.querySelector('foliate-view').renderer
    const { doc, index } = renderer.getContents()[0]
    const style = doc.defaultView.getComputedStyle(doc.documentElement)
    const perScreen = Math.round(renderer.size / (parseFloat(style.columnWidth) + parseFloat(style.columnGap)))
    const frame = doc.defaultView.frameElement.getBoundingClientRect()
    const area = renderer.getBoundingClientRect()
    const range = doc.createRange()
    range.selectNodeContents(doc.body)
    const rects = [...range.getClientRects()]
        .map(rect => ({ left: rect.left + frame.left, right: rect.right + frame.left, top: rect.top + frame.top, width: rect.width }))
        .filter(rect => rect.width > 0 && rect.left >= area.left - 1 && rect.right <= area.right + 1)
    return {
        at: `${index}:${renderer.page}`,
        perScreen,
        left: Math.min(...rects.map(rect => rect.left)),
        right: Math.max(...rects.map(rect => rect.right)),
        top: Math.min(...rects.map(rect => rect.top)),
        paddingTop: parseFloat(getComputedStyle(document.getElementById('book')).paddingTop),
    }
})

// Waits until the page has come to rest: off the paginator's blank lead-in
// and unchanged for half a second from now.
const settled = async page => {
    await page.evaluate(() => { window.__orielAt = null })
    await page.waitForFunction(() => {
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
}

const chapter = page => page.locator('#reading-footer .chapter').innerText().then(text => text.trim())
const controlsShown = page => page.locator('#controls header').isVisible()
const box = (page, selector) => page.evaluate(selector => {
    const element = document.querySelector(selector)
    if (!element?.checkVisibility()) return null
    const { left, right, top, bottom, width } = element.getBoundingClientRect()
    return { left, right, top, bottom, width }
}, selector)

const browser = await webkit.launch()
let failed = false
try {
    const context = await browser.newContext({ ...devices['iPhone 13'], viewport: PORTRAIT })
    await context.addInitScript(value => {
        localStorage.setItem('jellyfin_credentials', value)
        localStorage.setItem('oriel-hints', JSON.stringify({ first: true, scroll: true }))
    }, credentials)
    const page = await context.newPage()
    await page.goto(`${base}/Oriel/?id=${itemId}`)
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 }).catch(() => fail('the reader did not render the book'))
    await settled(page)

    // Turning from portrait to landscape and back keeps the chapter on screen.
    await page.evaluate(() => document.querySelector('foliate-view').goToFraction(0.5))
    await settled(page)
    const portrait = { chapter: await chapter(page), at: (await shown(page)).at }
    await page.setViewportSize(LANDSCAPE)
    await settled(page)
    const turned = { chapter: await chapter(page), at: (await shown(page)).at }
    if (turned.chapter !== portrait.chapter || turned.at.split(':')[0] !== portrait.at.split(':')[0]) fail(`turning to landscape moved the book from ${portrait.chapter} (${portrait.at}) to ${turned.chapter} (${turned.at})`)
    await page.setViewportSize(PORTRAIT)
    await settled(page)
    const back = { chapter: await chapter(page), at: (await shown(page)).at }
    if (back.chapter !== portrait.chapter || back.at.split(':')[0] !== portrait.at.split(':')[0]) fail(`turning back to portrait moved the book from ${portrait.chapter} (${portrait.at}) to ${back.chapter} (${back.at})`)
    pass(`turning from portrait to landscape and back keeps ${portrait.chapter} on screen (${portrait.at}, ${turned.at}, ${back.at})`)

    // One centred column, at least 122 px from each side, with the phone's top margin.
    await page.setViewportSize(LANDSCAPE)
    await settled(page)
    const land = await shown(page)
    if (land.perScreen !== 1) fail(`in landscape the book shows ${land.perScreen} columns, not one`)
    if (land.left < 121 || LANDSCAPE.width - land.right < 121) fail(`in landscape the text runs from ${Math.round(land.left)} to ${Math.round(land.right)} px, closer than 122 px to a side`)
    if (Math.abs(land.left - (LANDSCAPE.width - land.right)) > 24) fail(`in landscape the text is not centred: ${Math.round(land.left)} px at the left, ${Math.round(LANDSCAPE.width - land.right)} px at the right`)
    if (land.paddingTop !== 16) fail(`in landscape the top margin is ${land.paddingTop} px, not the phone's 16 px`)
    const footer = await box(page, '#reading-footer')
    if (!footer || Math.round(footer.left) !== 122 || Math.round(LANDSCAPE.width - footer.right) !== 122) fail(`the reading footer is not 122 px from each side: ${JSON.stringify(footer)}`)
    pass(`in landscape the book shows one column from ${Math.round(land.left)} to ${Math.round(land.right)} px with a 16 px top margin, and the reading footer lines up 122 px from each side`)

    // The phone's controls, with no arrows at the edges.
    await press(page, 0.5, true)
    await pause(600)
    if (!await controlsShown(page)) fail('a tap in the middle did not show the controls in landscape')
    const header = await box(page, '#controls header')
    const bar = await box(page, '#controls footer')
    if (!header || Math.round(header.top) !== 0 || !bar || Math.round(bar.bottom) !== LANDSCAPE.height) fail(`the header and footer are not at the top and bottom: ${JSON.stringify({ header, bar })}`)
    if (await box(page, '.page-arrow.previous') || await box(page, '.page-arrow.next')) fail('arrows show at the edges in landscape')
    if (await box(page, '#controls .full-screen')) fail('the desktop\'s Full screen shows in landscape')
    if (!await box(page, '#controls footer input[type="range"]')) fail('the footer has no position slider in landscape')
    pass('a tap in the middle shows the phone\'s header and footer, with the slider and no arrows or Full screen')

    // Contents and Preferences open over the right half, over the dimmed page.
    const before = (await shown(page)).at
    const panels = [
        ['Contents', '#contents', '#contents-backdrop', 'header button[aria-label="Contents"]', () => page.click('#contents button[aria-label="Close"]')],
        ['Preferences', '#prefs', '#prefs-backdrop', 'header button[aria-label="Preferences"]', () => page.mouse.click(120, 200)],
    ]
    for (const [name, selector, backdrop, opener, close] of panels) {
        if (!await controlsShown(page)) await press(page, 0.5, true)
        await page.click(`#controls ${opener}`)
        await page.waitForSelector(`${selector}:not([hidden])`, { timeout: 5_000 }).catch(() => fail(`${name} did not open`))
        await pause(400)
        const panel = await box(page, selector)
        if (!panel || Math.abs(panel.left - LANDSCAPE.width / 2) > 1 || Math.round(panel.right) !== LANDSCAPE.width || Math.round(panel.top) !== 0 || Math.round(panel.bottom) !== LANDSCAPE.height) fail(`${name} is not over the right half of the screen, its full height: ${JSON.stringify(panel)}`)
        if (!await box(page, backdrop)) fail(`${name} opens without dimming the page`)
        await close()
        await page.waitForSelector(selector, { state: 'hidden', timeout: 5_000 }).catch(() => fail(`${name} did not close`))
        await settled(page)
        const after = (await shown(page)).at
        if (after !== before) fail(`after closing ${name} the book shows ${after}, not ${before}`)
        pass(`${name} opens over the right half of the screen (from ${Math.round(panel.left)} px), its full height, over the dimmed page; closing it leaves ${after}`)
    }
} catch (error) {
    console.error(`FAIL: webkit: ${error.message}`)
    failed = true
} finally {
    await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 10_000))])
}
process.exit(failed ? 1 : 0)
