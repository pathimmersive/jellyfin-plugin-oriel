// Checks, in Playwright WebKit, that Oriel opens a book at the position saved in
// Jellyfin's user data and writes the position back as pages are turned:
// opening shows ORIEL_EXPECT_TEXT, opening alone writes nothing, and after a few
// page turns the server returns a later position than ORIEL_SAVED_TICKS.
// Configured by environment: ORIEL_BASE (server URL including any BaseUrl),
// ORIEL_SERVER_ID, ORIEL_USER_ID, ORIEL_TOKEN, ORIEL_ITEM_ID, ORIEL_SAVED_TICKS
// and ORIEL_EXPECT_TEXT. Exits non-zero on the first failed check.
import { webkit } from 'playwright'

const env = name => {
    const value = process.env[name]
    if (!value) {
        console.error(`FAIL: ${name} is not set`)
        process.exit(2)
    }
    return value
}

const base = env('ORIEL_BASE')
const serverId = env('ORIEL_SERVER_ID')
const userId = env('ORIEL_USER_ID')
const token = env('ORIEL_TOKEN')
const itemId = env('ORIEL_ITEM_ID')
const savedTicks = Number(env('ORIEL_SAVED_TICKS'))
const expectText = env('ORIEL_EXPECT_TEXT')
// A little longer than the reader waits after the last page turn before writing.
const WRITE_WAIT_MS = 7000

const credentials = JSON.stringify({
    Servers: [{ Id: serverId, AccessToken: token, UserId: userId, ManualAddress: new URL(base).origin, DateLastAccessed: Date.now() }],
})

const fail = message => { throw new Error(message) }
const pass = message => console.log(`PASS: ${message}`)

const savedPosition = async () => {
    const response = await fetch(`${base}/UserItems/${itemId}/UserData?userId=${userId}`, {
        headers: { Authorization: `MediaBrowser Client="oriel-smoke", Device="smoke", DeviceId="oriel-smoke", Version="1.0.0", Token="${token}"` },
    })
    if (!response.ok) fail(`GET user data returned ${response.status}`)
    return (await response.json()).PlaybackPositionTicks ?? 0
}

const frameText = async page => (await Promise.all(page.frames().map(frame =>
    frame.evaluate(() => document.body?.innerText ?? '').catch(() => '')))).join('\n')

const browser = await webkit.launch()
let failed = false
try {
    const context = await browser.newContext()
    await context.addInitScript(value => { localStorage.setItem('jellyfin_credentials', value) }, credentials)
    const page = await context.newPage()

    // Placing the saved position depends on the page layout being ready, so open
    // the book several times; each time it must show a text page, never the
    // blank lead page (page 0), at the saved chapter.
    const OPENS = 5
    for (let open = 1; open <= OPENS; open++) {
        await page.goto(`${base}/Oriel/?id=${itemId}`)
        await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 })
            .catch(() => fail('the reader did not render the book'))
        let text = ''
        for (let i = 0; i < 20 && !text.includes(expectText); i++) {
            await page.waitForTimeout(500)
            text = await frameText(page)
        }
        const shown = await page.evaluate(() => document.querySelector('foliate-view').renderer.page)
        if (shown === 0) fail(`open ${open} of ${OPENS} showed the blank lead page instead of the saved position`)
        if (!text.includes(expectText)) fail(`open ${open} of ${OPENS} did not show the saved position: '${expectText}' is not shown`)
    }
    pass(`a direct link at ${base} opens the book at its saved position, showing '${expectText}', ${OPENS} times out of ${OPENS}`)

    await page.waitForTimeout(WRITE_WAIT_MS)
    const afterOpen = await savedPosition()
    if (afterOpen !== savedTicks) fail(`opening the book changed the saved position from ${savedTicks} to ${afterOpen}`)
    pass('opening the book leaves the saved position as it was')

    for (let i = 0; i < 3; i++) {
        await page.evaluate(() => document.querySelector('foliate-view').next())
        await page.waitForTimeout(400)
    }
    await page.waitForTimeout(WRITE_WAIT_MS)
    const afterTurns = await savedPosition()
    if (!(afterTurns > savedTicks)) fail(`after three page turns the saved position is ${afterTurns}, not past ${savedTicks}`)
    pass(`after three page turns the reader saved a later position (${savedTicks} to ${afterTurns} ticks)`)
} catch (error) {
    console.error(`FAIL: ${error.message}`)
    failed = true
} finally {
    await browser.close()
}
process.exit(failed ? 1 : 0)
