// Takes the README's screenshots from a running server: an iPhone reading with
// the controls shown, an iPhone's Preferences with the theme row, and the
// desktop two-page spread with Contents open beside the page. Use a book in
// the public domain, never one under copyright; the README's show Standard
// Ebooks' Pride and Prejudice (CC0). For the theme row it adds Night Blue to
// the user's themes and puts their list back afterwards.
// Usage: ORIEL_BASE=... ORIEL_SERVER_ID=... ORIEL_USER_ID=... ORIEL_TOKEN=... ORIEL_ITEM_ID=... node scripts/make-screenshots.mjs
// Playwright comes from the reader's packages (npm ci in src/reader).
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { press } from '../src/reader/e2e/press.mjs'

const root = new URL('../', import.meta.url)
const { chromium, devices, webkit } = createRequire(new URL('src/reader/package.json', root))('playwright')
const file = path => fileURLToPath(new URL(path, root))

const env = name => {
    const value = process.env[name]
    if (!value) {
        console.error(`make-screenshots: ${name} is not set`)
        process.exit(2)
    }
    return value
}
const base = env('ORIEL_BASE')
const token = env('ORIEL_TOKEN')
const itemId = env('ORIEL_ITEM_ID')
const credentials = JSON.stringify({
    Servers: [{ Id: env('ORIEL_SERVER_ID'), AccessToken: token, UserId: env('ORIEL_USER_ID'), ManualAddress: new URL(base).origin, DateLastAccessed: Date.now() }],
})
const authorization = `MediaBrowser Client="oriel-screenshots", Device="screenshots", DeviceId="oriel-screenshots", Version="1.0.0", Token="${token}"`
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
// Where the shots open: early in Chapter 1, past the front matter.
const PLACE = Number(process.env.ORIEL_FRACTION ?? 0.012)

const themes = async list => {
    const response = await fetch(`${base}/Oriel/Themes`, {
        method: list ? 'PUT' : 'GET',
        headers: { Authorization: authorization, 'Content-Type': 'application/json' },
        body: list ? JSON.stringify(list) : undefined,
    })
    if (!response.ok) throw new Error(`${list ? 'PUT' : 'GET'} /Oriel/Themes returned ${response.status}`)
    return response.json()
}
const NIGHT_BLUE = {
    name: 'Night Blue',
    background: '#0f1a2a', text: '#d7dee8', secondary: '#9fb0c4', accent: '#7cc4ff', selection: '#2e5a85',
    separator: '#2b4466', controls: '#14243a', controlsText: '#e6edf5', buttons: '#23395a', grayed: '#6c7f96',
}

// Opens the book at the place, signed in, with the first-open hints already seen.
const open = async (browser, context) => {
    const session = await browser.newContext(context)
    await session.addInitScript(value => {
        localStorage.setItem('jellyfin_credentials', value)
        localStorage.setItem('oriel-hints', JSON.stringify({ first: true, scroll: true }))
    }, credentials)
    const page = await session.newPage()
    await page.goto(`${base}/Oriel/?id=${itemId}`)
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 60_000 })
    await page.evaluate(fraction => document.querySelector('foliate-view').goToFraction(fraction), PLACE)
    await pause(2500)
    return { session, page }
}

const kept = await themes()
let failed = false
try {
    await themes([...kept.map(({ id, ...theme }) => ({ id, ...theme })), ...(kept.some(theme => theme.name === NIGHT_BLUE.name) ? [] : [NIGHT_BLUE])])

    const phoneBrowser = await webkit.launch()
    try {
        const { session, page } = await open(phoneBrowser, { ...devices['iPhone 13'], deviceScaleFactor: 2 })
        if (!await press(page, 0.5, true)) throw new Error('no frame shows the page to tap')
        await pause(800)
        await page.screenshot({ path: file('images/reading-phone.png') })
        await page.getByRole('button', { name: 'Preferences' }).tap()
        await pause(1000)
        await page.screenshot({ path: file('images/preferences-phone.png') })
        await session.close()
    } finally {
        await phoneBrowser.close()
    }

    const deskBrowser = await chromium.launch()
    try {
        const { session, page } = await open(deskBrowser, { viewport: { width: 1440, height: 900 } })
        // A click in the middle of the page shows the controls, as on a phone a tap does.
        if (!await press(page, 0.5, false)) throw new Error('no frame shows the page to click')
        await pause(800)
        await page.click('#controls header button[aria-label="Contents"]')
        await pause(1500)
        await page.screenshot({ path: file('images/spread-desktop.png') })
        await session.close()
    } finally {
        await deskBrowser.close()
    }
    console.log('make-screenshots: wrote images/reading-phone.png, images/preferences-phone.png and images/spread-desktop.png')
} catch (error) {
    console.error(`make-screenshots: ${error.message}`)
    failed = true
} finally {
    await themes(kept).catch(() => {})
}
process.exit(failed ? 1 : 0)
