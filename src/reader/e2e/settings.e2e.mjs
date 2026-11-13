// Checks Oriel's settings page in Jellyfin's Dashboard, at desktop size, in the
// browser named by ORIEL_BROWSER (webkit or chromium). The Dashboard lists the
// page; it opens showing the server's values; changing the Play takeover, font
// uploads and the Translate address and saving changes the configuration, and
// without a restart Play opens Jellyfin's own reader, Preferences offers Add
// font and the reader is given the new Translate address; an http address is
// refused before saving. The values the server had are put back afterwards.
// Configured by environment: ORIEL_BASE (server URL including any BaseUrl),
// ORIEL_SERVER_ID, ORIEL_USER_ID, ORIEL_TOKEN (an admin's), ORIEL_ITEM_ID (the
// test EPUB) and ORIEL_BROWSER. Exits non-zero on the first failed check.
import { chromium, webkit } from 'playwright'
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
const token = env('ORIEL_TOKEN')
const itemId = env('ORIEL_ITEM_ID')
const browserName = env('ORIEL_BROWSER')
const engines = { webkit, chromium }
if (!engines[browserName]) {
    console.error(`FAIL: ORIEL_BROWSER is '${browserName}', expected webkit or chromium`)
    process.exit(2)
}
const credentials = JSON.stringify({
    Servers: [{ Id: env('ORIEL_SERVER_ID'), AccessToken: token, UserId: env('ORIEL_USER_ID'), ManualAddress: base, DateLastAccessed: Date.now() }],
})

const fail = message => { throw new Error(message) }
const pass = message => console.log(`PASS: ${browserName}: ${message}`)

const PLUGIN_ID = '2c488ea7-0cae-4499-a2a7-6bae27b4e8f6'
const GOOGLE = 'https://translate.google.com/?sl=auto&op=translate&text={text}'
const DEEPL = 'https://www.deepl.com/translator#auto/en/{text}'
const authorization = `MediaBrowser Client="oriel-e2e", Device="e2e", DeviceId="oriel-e2e-settings", Version="1.0.0", Token="${token}"`
const call = async (path, init = {}) => {
    const response = await fetch(`${base}${path}`, { ...init, headers: { Authorization: authorization, 'Content-Type': 'application/json', ...init.headers } })
    if (!response.ok) fail(`${init.method ?? 'GET'} ${path} returned ${response.status}`)
    const text = await response.text()
    return text ? JSON.parse(text) : null
}
const configuration = () => call(`/Plugins/${PLUGIN_ID}/Configuration`)
const configure = settings => configuration().then(current => call(`/Plugins/${PLUGIN_ID}/Configuration`, { method: 'POST', body: JSON.stringify({ ...current, ...settings }) }))
const launcherServed = async () => (await (await fetch(`${base}/web/index.html`)).text()).includes('Oriel/integration/launcher.js')

// jellyfin-web keeps earlier views in the page, hidden; checks look at the one on screen.
const PAGE = '#orielSettingsPage:not(.hide)'

const browser = await engines[browserName].launch()
const original = await configuration()
let failed = false
try {
    await configure({ EnableWebIntegration: true, EnableFontUploads: false, TranslateUrl: GOOGLE })
    const pages = await call('/web/ConfigurationPages')
    if (!pages.some(page => page.Name === 'oriel')) fail(`the Dashboard's plugin pages are ${JSON.stringify(pages.map(page => page.Name))}`)

    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    await context.addInitScript(value => {
        localStorage.setItem('jellyfin_credentials', value)
        localStorage.setItem('oriel-hints', JSON.stringify({ first: true, scroll: true }))
    }, credentials)
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${base}/web/#/configurationpage?name=oriel`)
    await page.waitForSelector(`${PAGE}[data-loaded="true"]`, { timeout: 30_000 })
        .catch(() => fail(`the settings page did not open with the server's values (at ${page.url()}; ${errors.join('; ') || 'no page errors'})`))
    const shown = async () => ({
        takeover: await page.locator(`${PAGE} #orielWebIntegration`).isChecked(),
        uploads: await page.locator(`${PAGE} #orielFontUploads`).isChecked(),
        translate: await page.locator(`${PAGE} #orielTranslateUrl`).inputValue(),
    })
    const opened = await shown()
    if (!opened.takeover || opened.uploads || opened.translate !== GOOGLE) fail(`the page opened showing ${JSON.stringify(opened)}`)
    const kinds = await page.evaluate(selector => [...document.querySelectorAll(`${selector} input`)].map(input => input.getAttribute('is')), PAGE)
    if (kinds.join() !== 'emby-checkbox,emby-checkbox,emby-input') fail(`the page's fields are ${kinds.join(', ')}, not Jellyfin's own`)
    const note = await page.locator(`${PAGE} #orielTranslateUrl ~ .fieldDescription, ${PAGE} .inputContainer .fieldDescription`).first().innerText()
    if (!note.includes('the text they selected is sent to this site')) fail(`the Translate note says '${note}'`)
    pass("the Dashboard lists Oriel's settings page, which opens with the server's values in Jellyfin's own fields and says where Translate sends text")

    // An http address is refused before anything is saved.
    await page.locator(`${PAGE} #orielTranslateUrl`).fill('http://translate.example.lan/?q={text}')
    await page.locator(`${PAGE} button[type="submit"]`).click()
    const refusal = page.locator(`${PAGE} .orielSettingsError`)
    await refusal.waitFor({ state: 'visible', timeout: 5000 }).catch(() => fail('an http Translate address was not refused'))
    if ((await refusal.innerText()).trim() !== 'The Translate address must start with https://.') fail(`an http address is refused with '${await refusal.innerText()}'`)
    if ((await configuration()).TranslateUrl !== GOOGLE) fail('an http Translate address was saved')
    pass("an http Translate address is refused with 'The Translate address must start with https://.' and nothing is saved")

    // Each setting changed and saved.
    await page.locator(`${PAGE} #orielWebIntegration`).setChecked(false, { force: true })
    await page.locator(`${PAGE} #orielFontUploads`).setChecked(true, { force: true })
    await page.locator(`${PAGE} #orielTranslateUrl`).fill(DEEPL)
    await page.locator(`${PAGE} button[type="submit"]`).click()
    await page.locator(`${PAGE} .orielSettingsSaved`).waitFor({ state: 'visible', timeout: 10_000 }).catch(() => fail('Save did not say Saved.'))
    const saved = await configuration()
    if (saved.EnableWebIntegration !== false || saved.EnableFontUploads !== true || saved.TranslateUrl !== DEEPL) {
        fail(`after Save the configuration is ${JSON.stringify({ EnableWebIntegration: saved.EnableWebIntegration, EnableFontUploads: saved.EnableFontUploads, TranslateUrl: saved.TranslateUrl })}`)
    }
    await page.reload()
    await page.waitForSelector(`${PAGE}[data-loaded="true"]`, { timeout: 30_000 })
    const again = await shown()
    if (again.takeover || !again.uploads || again.translate !== DEEPL) fail(`after a reload the page shows ${JSON.stringify(again)}`)
    pass('saving the three changes stores them, and the page shows them again after a reload')

    // The reader and jellyfin-web follow at once.
    if (await launcherServed()) fail('with the takeover off jellyfin-web still loads Oriel\'s launcher')
    await page.goto(`${base}/web/#/details?id=${itemId}`)
    const play = page.locator('.btnPlay:visible').first()
    await play.waitFor({ timeout: 30_000 }).catch(() => fail('no Play button on the detail page'))
    await play.click()
    await page.waitForSelector('#bookPlayer', { timeout: 30_000 }).catch(() => fail(`with the takeover off Play went to ${page.url()}, not Jellyfin's own reader`))
    const readerSettings = await call('/Oriel/ReaderSettings')
    if (readerSettings.fontUploads !== true || readerSettings.translateUrl !== DEEPL) fail(`the reader is given ${JSON.stringify(readerSettings)}`)
    const reader = await context.newPage()
    await reader.goto(`${base}/Oriel/?id=${itemId}`)
    await reader.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 }).catch(() => fail('the reader did not render the test EPUB'))
    await reader.waitForTimeout(1500)
    if (!await reader.locator('#controls header').isVisible()) {
        if (!await press(reader, 0.5, false)) fail('no frame shows the page to click')
        await reader.waitForTimeout(600)
    }
    await reader.getByRole('button', { name: 'Preferences' }).click()
    await reader.getByRole('group', { name: 'Font' }).getByRole('button', { name: 'Add font' }).waitFor({ timeout: 5000 })
        .catch(() => fail('with uploads on Preferences has no Add font'))
    pass('without a restart, Play opens Jellyfin\'s own reader, Preferences offers Add font, and the reader is given the new Translate address')
    await context.close()
} catch (error) {
    console.error(`FAIL: ${browserName}: ${error.message}`)
    failed = true
} finally {
    await configure({ EnableWebIntegration: original.EnableWebIntegration, EnableFontUploads: original.EnableFontUploads, TranslateUrl: original.TranslateUrl }).catch(() => {})
    await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 10_000))])
}
process.exit(failed ? 1 : 0)
