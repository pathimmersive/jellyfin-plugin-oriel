// Checks an Android phone in Chromium emulating one at 412x915 with touch and
// an Android browser's user agent, as the canvas's AndroidRead,
// AndroidControls, AndroidPrefs and AndroidSelect draw it: the book shows as
// one column inside the phone's margins with the reading footer on screen; a
// tap in the middle shows the header at the top and the footer at the bottom,
// with the slider and no arrows or Full screen; Preferences opens as a sheet
// from 120 px down over the dimmed page; and the Selected text toolbar sits
// 16 px from the sides and 32 px clear of the selected text, where Android
// draws its selection handles. Emulation draws no status bar, navigation bar
// or handles, so the safe-area insets are 0 here.
// Configured by environment: ORIEL_BASE (server URL including any BaseUrl),
// ORIEL_SERVER_ID, ORIEL_USER_ID, ORIEL_TOKEN and ORIEL_ITEM_ID (the test
// EPUB). Exits non-zero on the first failed check.
import { chromium, devices } from 'playwright'
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
const pass = message => console.log(`PASS: android: ${message}`)
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

const SCREEN = { width: 412, height: 915 }
// How far below a line Android draws its selection handles, and the space the toolbar keeps from the text on a touch screen.
const HANDLES = 24
const TOUCH_GAP = 32

// The columns a screen shows and the left and right edges of the text shown, in the window.
const shown = page => page.evaluate(() => {
    const renderer = document.querySelector('foliate-view').renderer
    const { doc } = renderer.getContents()[0]
    const style = doc.defaultView.getComputedStyle(doc.documentElement)
    const perScreen = Math.round(renderer.size / (parseFloat(style.columnWidth) + parseFloat(style.columnGap)))
    const frame = doc.defaultView.frameElement.getBoundingClientRect()
    const area = renderer.getBoundingClientRect()
    const range = doc.createRange()
    range.selectNodeContents(doc.body)
    const rects = [...range.getClientRects()]
        .map(rect => ({ left: rect.left + frame.left, right: rect.right + frame.left, width: rect.width }))
        .filter(rect => rect.width > 0 && rect.left >= area.left - 1 && rect.right <= area.right + 1)
    return { perScreen, left: Math.min(...rects.map(rect => rect.left)), right: Math.max(...rects.map(rect => rect.right)) }
})

const box = (page, selector) => page.evaluate(selector => {
    const element = document.querySelector(selector)
    if (!element?.checkVisibility()) return null
    const { left, right, top, bottom, width, height } = element.getBoundingClientRect()
    return { left, right, top, bottom, width, height }
}, selector)

const controlsShown = page => page.locator('#controls header').isVisible()

const browser = await chromium.launch()
let failed = false
try {
    const context = await browser.newContext({ ...devices['Pixel 7'], viewport: SCREEN })
    await context.addInitScript(value => {
        localStorage.setItem('jellyfin_credentials', value)
        localStorage.setItem('oriel-hints', JSON.stringify({ first: true, scroll: true }))
    }, credentials)
    const page = await context.newPage()
    await page.goto(`${base}/Oriel/?id=${itemId}`)
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 }).catch(() => fail('the reader did not render the book'))
    if (!await page.evaluate(() => /Android/.test(navigator.userAgent) && matchMedia('(pointer: coarse)').matches)) fail('the browser is not an Android phone with touch')
    await page.evaluate(() => document.querySelector('foliate-view').goToFraction(0))
    await pause(1500)

    // One column inside the phone's 24 px margins, the reading footer on screen.
    const reading = await shown(page)
    if (reading.perScreen !== 1) fail(`the book shows ${reading.perScreen} columns, not one`)
    if (reading.left < 23 || SCREEN.width - reading.right < 23) fail(`the text runs from ${Math.round(reading.left)} to ${Math.round(reading.right)} px, inside the phone's 24 px margins`)
    const footer = await box(page, '#reading-footer')
    if (!footer || footer.bottom > SCREEN.height || Math.round(footer.left) !== 24 || Math.round(SCREEN.width - footer.right) !== 24) fail(`the reading footer is not on screen 24 px from each side: ${JSON.stringify(footer)}`)
    pass(`the book shows one column from ${Math.round(reading.left)} to ${Math.round(reading.right)} px, and the reading footer is on screen 24 px from each side`)

    // The controls: the header at the top, the footer at the bottom, no arrows.
    await press(page, 0.5, true)
    await pause(600)
    if (!await controlsShown(page)) fail('a tap in the middle did not show the controls')
    const header = await box(page, '#controls header')
    const bar = await box(page, '#controls footer')
    if (!header || Math.round(header.top) !== 0 || Math.round(header.height) !== 56) fail(`the header is not 56 px at the top: ${JSON.stringify(header)}`)
    if (!bar || Math.round(bar.bottom) !== SCREEN.height) fail(`the footer is not at the bottom: ${JSON.stringify(bar)}`)
    const small = await page.evaluate(() => [...document.querySelectorAll('#controls header button, #controls header a')]
        .filter(button => button.checkVisibility())
        .map(button => button.getBoundingClientRect())
        .filter(rect => rect.width < 44 || rect.height < 44).length)
    if (small) fail(`${small} header button(s) are smaller than 44 px`)
    if (!await box(page, '#controls footer input[type="range"]')) fail('the footer has no position slider')
    if (await box(page, '.page-arrow.previous') || await box(page, '.page-arrow.next') || await box(page, '#controls .full-screen')) fail('the desktop\'s arrows or Full screen show on Android')
    pass('a tap in the middle shows the 56 px header at the top and the footer with its slider at the bottom, every header button at least 44 px, no arrows or Full screen')

    // Preferences: a sheet from 120 px down over the dimmed page.
    await page.locator('#controls header button[aria-label="Preferences"]').tap()
    await page.waitForSelector('#prefs:not([hidden])', { timeout: 5_000 }).catch(() => fail('Preferences did not open'))
    await pause(400)
    const prefs = await box(page, '#prefs')
    if (!prefs || Math.round(prefs.top) !== 120 || Math.round(prefs.left) !== 0 || Math.round(prefs.right) !== SCREEN.width || Math.round(prefs.bottom) !== SCREEN.height) fail(`Preferences is not a sheet from 120 px down across the screen: ${JSON.stringify(prefs)}`)
    if (!await box(page, '#prefs-backdrop')) fail('Preferences opens without dimming the page')
    await page.locator('#prefs button[aria-label="Close"]').tap()
    await page.waitForSelector('#prefs', { state: 'hidden', timeout: 5_000 }).catch(() => fail('Preferences did not close'))
    if (await controlsShown(page)) await press(page, 0.5, true)
    await pause(600)
    pass('Preferences opens as a sheet from 120 px down over the dimmed page, and closes')

    // Selected text: the toolbar 16 px from the sides, clear of the handles.
    const selected = await page.evaluate(() => {
        const { doc } = document.querySelector('foliate-view').renderer.getContents()[0]
        const frame = doc.defaultView.frameElement.getBoundingClientRect()
        const area = document.querySelector('foliate-view').renderer.getBoundingClientRect()
        const text = [...doc.querySelectorAll('p')].map(p => p.firstChild).find(node => {
            if (node?.nodeType !== 3 || node.textContent.length < 20) return false
            const rect = doc.createRange()
            rect.selectNodeContents(node)
            const first = rect.getClientRects()[0]
            return first && first.left + frame.left >= area.left && first.right + frame.left <= area.right && first.top + frame.top > 200 && first.bottom + frame.top < 500
        })
        if (!text) return null
        const range = doc.createRange()
        range.setStart(text, 0)
        range.setEnd(text, 12)
        doc.getSelection().removeAllRanges()
        doc.getSelection().addRange(range)
        const rect = range.getBoundingClientRect()
        return { text: range.toString(), top: rect.top + frame.top, bottom: rect.bottom + frame.top }
    })
    if (!selected) fail('no paragraph on the page to select')
    await pause(800)
    const toolbar = await box(page, '#selection-toolbar')
    if (!toolbar) fail(`selecting '${selected.text}' did not show the Selected text toolbar`)
    if (Math.round(toolbar.left) !== 16 || Math.round(SCREEN.width - toolbar.right) !== 16) fail(`the toolbar is not 16 px from the sides: ${JSON.stringify(toolbar)}`)
    const below = toolbar.top >= selected.bottom
    const space = below ? toolbar.top - selected.bottom : selected.top - toolbar.bottom
    if (below && space < HANDLES) fail(`the toolbar is ${Math.round(space)} px below '${selected.text}', over the ${HANDLES} px where Android draws its selection handles`)
    if (Math.round(space) !== TOUCH_GAP) fail(`the toolbar is ${Math.round(space)} px ${below ? 'below' : 'above'} '${selected.text}', not ${TOUCH_GAP} px`)
    pass(`selecting '${selected.text}' shows the toolbar 16 px from the sides and ${Math.round(space)} px ${below ? 'below' : 'above'} the text, clear of the handles`)
} catch (error) {
    console.error(`FAIL: android: ${error.message}`)
    failed = true
} finally {
    await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 10_000))])
}
process.exit(failed ? 1 : 0)
