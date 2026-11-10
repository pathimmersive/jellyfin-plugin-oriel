// Checks, in the browser named by ORIEL_BROWSER (webkit at iPhone size with
// touch, or chromium at desktop size with a mouse), that the theme and font a
// reader chooses follow them. Two browser contexts stand in for two devices
// signed in as the same user. With Night Blue among their themes and 'Oriel
// Sync Sans' among their fonts, choosing both in the first context keeps them
// on the server; the second context, which has its own size and margins, opens
// with Night Blue and Oriel Sync Sans chosen and its size and margins as it had
// them. Preferences' note and the Reset dialog say what stays on this device
// and what follows the reader. A choice made while the server cannot be
// reached shows at once and is sent once the server answers. Configured by
// environment: ORIEL_BASE (server URL including any BaseUrl), ORIEL_SERVER_ID,
// ORIEL_USER_ID, ORIEL_TOKEN, ORIEL_ITEM_ID (the test EPUB) and ORIEL_BROWSER.
// Exits non-zero on the first failed check.
import { chromium, devices, webkit } from 'playwright'
import { forgetChoices } from './choices.mjs'
import { makeFont } from './make-font.mjs'
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
const token = env('ORIEL_TOKEN')
const credentials = JSON.stringify({
    Servers: [{
        Id: env('ORIEL_SERVER_ID'),
        AccessToken: token,
        UserId: env('ORIEL_USER_ID'),
        ManualAddress: origin,
        DateLastAccessed: Date.now(),
    }],
})
const itemId = env('ORIEL_ITEM_ID')
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
const use = locator => setup.touch ? locator.tap() : locator.click()
const until = async (check, ms, message) => {
    for (const end = Date.now() + ms; Date.now() < end; await pause(250)) {
        if (await check()) return
    }
    fail(message())
}

// Night Blue, as the canvas draws it, and a font made from Atkinson Hyperlegible (SIL Open Font License) and renamed.
const NIGHT_BLUE = {
    name: 'Night Blue',
    background: '#0f1a2a', text: '#d7dee8', secondary: '#9fb0c4', accent: '#7cc4ff', selection: '#2e5a85',
    separator: '#2b4466', controls: '#14243a', controlsText: '#e6edf5', buttons: '#23395a', grayed: '#6c7f96',
}
const CARD = 'Night Blue, a custom theme; open it to edit'
const FAMILY = 'Oriel Sync Sans'
const font = makeFont(new URL('../node_modules/@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff', import.meta.url), FAMILY, 'ttf')
// The second device's own layout.
const SECOND = { size: 24, margins: { left: 60, right: 60, top: 30, bottom: 20 } }

// The user's themes, fonts and choices on the server, as the user.
const authorization = `MediaBrowser Client="oriel-e2e", Device="e2e", DeviceId="oriel-e2e-sync", Version="1.0.0", Token="${token}"`
const call = async (path, init = {}) => {
    const response = await fetch(`${base}${path}`, { ...init, headers: { Authorization: authorization, ...init.headers } })
    if (!response.ok) fail(`${init.method ?? 'GET'} ${path} returned ${response.status}`)
    return response.status === 204 ? null : response.json()
}
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const choices = () => call('/Oriel/Choices')
const clear = async () => {
    await forgetChoices(base, token)
    await call('/Oriel/Themes', json('PUT', []))
    for (const family of new Set((await call('/Oriel/Fonts')).map(kept => kept.family))) {
        await fetch(`${base}/Oriel/Fonts?family=${encodeURIComponent(family)}`, { method: 'DELETE', headers: { Authorization: authorization } })
    }
}

const device = async (browser, settings) => {
    const context = await browser.newContext(setup.context)
    await context.addInitScript(([value, kept]) => {
        // Only on the first load: a reload keeps what the reader has since done.
        if (localStorage.getItem('jellyfin_credentials')) return
        localStorage.setItem('jellyfin_credentials', value)
        localStorage.setItem('oriel-hints', JSON.stringify({ first: true, scroll: true }))
        if (kept) localStorage.setItem('oriel-settings', JSON.stringify(kept))
    }, [credentials, settings])
    return context
}

const open = async context => {
    const page = await context.newPage()
    await page.goto(`${base}/Oriel/?id=${itemId}`)
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 })
        .catch(() => fail('the reader did not render the test EPUB'))
    await pause(1500)
    return page
}

const openPrefs = async page => {
    if (!await page.locator('#controls header').isVisible()) {
        if (!await pressAt(page, 0.5, setup.touch)) fail('no frame shows the page to tap')
        await pause(600)
    }
    await use(page.getByRole('button', { name: 'Preferences' }))
    await pause(400)
    const panel = page.locator('#prefs')
    if (!await panel.isVisible()) fail('Preferences did not open')
    return panel
}

const pressed = async (panel, group, name) =>
    await panel.getByRole('group', { name: group }).getByRole('button', { name, exact: true }).getAttribute('aria-pressed') === 'true'

// The book's page and text as shown, and what this device keeps.
const shown = page => page.evaluate(() => {
    const { doc } = document.querySelector('foliate-view').renderer.getContents()[0]
    const body = doc.defaultView.getComputedStyle(doc.body)
    const text = doc.defaultView.getComputedStyle(doc.querySelector('p'))
    return { page: body.backgroundColor, font: text.fontFamily, size: parseFloat(text.fontSize), kept: JSON.parse(localStorage.getItem('oriel-settings') ?? '{}') }
})

const browser = await setup.engine.launch()
let failed = false
try {
    await clear()
    const [theme] = await call('/Oriel/Themes', json('PUT', [NIGHT_BLUE]))
    await call('/Oriel/Fonts', { method: 'POST', body: font })
    const phone = setup.touch ? 'phone' : 'computer'

    // The first device: what stays and what follows, then the choice.
    const first = await device(browser, null)
    let page = await open(first)
    let panel = await openPrefs(page)
    const note = (await panel.locator('.note').innerText()).trim()
    if (note !== `Size, spacing, margins and page turn apply to this ${phone}. Themes, fonts and highlighters follow you on every device.`) fail(`the Preferences note reads '${note}'`)
    const reset = panel.getByRole('button', { name: 'Reset to defaults', exact: true })
    await reset.scrollIntoViewIfNeeded()
    await use(reset)
    await pause(400)
    const dialog = page.getByRole('alertdialog')
    const words = (await dialog.locator('p').innerText()).trim()
    if (words !== `Size, spacing, margins and page turn on this ${phone} go back to the defaults. Your themes, fonts and highlighters stay as they are.`) fail(`the Reset dialog says '${words}'`)
    await use(dialog.getByRole('button', { name: 'Cancel', exact: true }))
    await pause(300)
    pass(`Preferences' note and the Reset dialog say size, spacing, margins and page turn stay on this ${phone} and themes, fonts and highlighters follow you`)

    await use(panel.getByRole('group', { name: 'Theme' }).getByRole('button', { name: CARD }))
    await pause(300)
    await use(panel.getByRole('group', { name: 'Font' }).getByRole('button', { name: FAMILY, exact: true }))
    const want = { theme: `own:${theme.id}`, font: `own:${FAMILY}` }
    await until(async () => JSON.stringify(await choices()) === JSON.stringify(want), 5000, () => `after choosing Night Blue and ${FAMILY} the server keeps another choice`)
    pass(`choosing Night Blue and ${FAMILY} on one device keeps them on the server`)

    // The second device, with its own size and margins.
    const second = await device(browser, SECOND)
    const other = await open(second)
    const seen = await shown(other)
    if (seen.page !== 'rgb(15, 26, 42)') fail(`the second device shows the page in ${seen.page}, not Night Blue's background`)
    if (!seen.font.includes(`Oriel own: ${FAMILY}`)) fail(`the second device sets the text in ${seen.font}`)
    if (seen.size !== SECOND.size || JSON.stringify(seen.kept.margins) !== JSON.stringify(SECOND.margins) || seen.kept.size !== SECOND.size) fail(`the second device's size and margins became ${seen.size} px, ${JSON.stringify(seen.kept.margins)}`)
    panel = await openPrefs(other)
    if (!await pressed(panel, 'Theme', CARD) || !await pressed(panel, 'Font', FAMILY)) fail('the second device\'s Preferences does not show Night Blue and the font chosen')
    pass(`a second device opens with Night Blue and ${FAMILY} chosen, and keeps its own size (${SECOND.size}) and margins`)

    // A choice made while the server cannot be reached shows at once and is sent once it answers.
    await other.route('**/Oriel/Choices', route => route.abort())
    await use(panel.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'Sepia', exact: true }))
    await pause(800)
    if ((await shown(other)).page !== 'rgb(244, 236, 216)') fail('with the server out of reach Sepia did not show at once')
    if ((await choices()).theme !== want.theme) fail('the server took the choice while it could not be reached')
    await other.unroute('**/Oriel/Choices')
    await until(async () => (await choices()).theme === 'sepia', 15_000, () => 'Sepia was not sent once the server could be reached')
    pass('a choice made while the server cannot be reached shows at once and is sent once it answers')

    // The first device takes it on its next open.
    await page.reload()
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 })
    await pause(1500)
    if ((await shown(page)).page !== 'rgb(244, 236, 216)') fail('the first device did not open in Sepia, chosen on the second')
    pass('the first device opens in Sepia, chosen on the second')
    await page.close()
    await other.close()
} catch (error) {
    console.error(`FAIL: ${browserName}: ${error.message}`)
    failed = true
} finally {
    await clear().catch(() => {})
    await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 10_000))])
}
process.exit(failed ? 1 : 0)
