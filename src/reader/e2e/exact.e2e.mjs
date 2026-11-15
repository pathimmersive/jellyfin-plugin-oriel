// Checks, in Playwright WebKit, that the reader keeps the exact position in the
// plugin's store and prefers whichever position was saved last: turning pages
// stores a CFI, reopening the book shows the same page, and a Jellyfin position
// saved later (as another app would) wins over the stored one. Configured by
// environment: ORIEL_BASE (server URL including any BaseUrl), ORIEL_SERVER_ID,
// ORIEL_USER_ID, ORIEL_TOKEN, ORIEL_ITEM_ID and ORIEL_LATER_TEXT, the first line
// of the chapter at 0.25 of the book. Exits non-zero on the first failed check.
import { webkit } from 'playwright'
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
const serverId = env('ORIEL_SERVER_ID')
const userId = env('ORIEL_USER_ID')
const token = env('ORIEL_TOKEN')
const itemId = env('ORIEL_ITEM_ID')
const laterText = env('ORIEL_LATER_TEXT')
// A little longer than the reader waits after the last page turn before saving.
const SAVE_WAIT_MS = 7000

const authorization = `MediaBrowser Client="oriel-smoke", Device="smoke", DeviceId="oriel-smoke", Version="1.0.0", Token="${token}"`
const credentials = JSON.stringify({
    Servers: [{ Id: serverId, AccessToken: token, UserId: userId, ManualAddress: new URL(base).origin, DateLastAccessed: Date.now() }],
})

const fail = message => { throw new Error(message) }
const pass = message => console.log(`PASS: ${message}`)

const api = async (path, init = {}) => {
    const response = await fetch(`${base}${path}`, { ...init, headers: { Authorization: authorization, 'Content-Type': 'application/json', ...init.headers } })
    return { status: response.status, body: response.status === 200 ? await response.json() : null }
}

const frameText = async page => (await Promise.all(page.frames().map(frame =>
    frame.evaluate(() => document.body?.innerText ?? '').catch(() => '')))).join('\n')

const open = async page => {
    await page.goto(`${base}/Oriel/?id=${itemId}`)
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 })
        .catch(() => fail('the reader did not render the book'))
}

const shown = page => page.evaluate(() => {
    const renderer = document.querySelector('foliate-view').renderer
    return `${renderer.getContents()[0]?.index}:${renderer.page}`
})

const browser = await webkit.launch()
let failed = false
try {
    const context = await browser.newContext()
    await context.addInitScript(value => {
        localStorage.setItem('jellyfin_credentials', value)
        // The reading gestures hint was seen on this device before.
        localStorage.setItem('oriel-hints', JSON.stringify({ first: true, scroll: true }))
    }, credentials)
    const page = await context.newPage()

    // Start from the beginning of the book, saved as if read elsewhere just now.
    const started = Date.now()
    await api(`/UserItems/${itemId}/UserData?userId=${userId}`, {
        method: 'POST', body: JSON.stringify({ PlaybackPositionTicks: 0, LastPlayedDate: new Date(started).toISOString() }),
    })
    await open(page)
    for (let i = 0; i < 2; i++) {
        const turned = await watchMove(page, `page turn ${i + 1} of 2 did not move`)
        await page.evaluate(() => document.querySelector('foliate-view').next())
        await turned()
    }
    const savedPage = await shown(page)
    // The position must be one the reader saved during this check, not one
    // stored earlier; the reader saves once its delay after the last turn has passed.
    const newlyStored = got => got.status === 200 && got.body?.cfi?.startsWith('epubcfi(') && Date.parse(got.body.savedAt) >= started - 2000
    const stored = await until(async () => { const got = await api(`/Oriel/Positions/${itemId}`); return newlyStored(got) && got },
        async () => {
            const got = await api(`/Oriel/Positions/${itemId}`)
            return `turning pages did not store a new exact position (GET /Oriel/Positions returned ${got.status} ${JSON.stringify(got.body)})`
        }, SAVE_WAIT_MS + 8000)
    pass(`turning pages at ${base} stores the exact position ${stored.body.cfi}`)

    // Jellyfin holds an older position elsewhere in the book, so a reader that
    // followed Jellyfin instead of the stored exact position would land there.
    await api(`/UserItems/${itemId}/UserData?userId=${userId}`, {
        method: 'POST',
        body: JSON.stringify({ PlaybackPositionTicks: 9_000_000, LastPlayedDate: new Date(Date.parse(stored.body.savedAt) - 3_600_000).toISOString() }),
    })
    await open(page)
    await until(async () => await shown(page) === savedPage,
        async () => `reopening showed ${await shown(page)}, not the page the position was saved on (${savedPage})`)
    pass(`reopening the book shows the same page it was saved on (${savedPage})`)

    // A later Jellyfin position, as from reading in another app, wins.
    const later = new Date(Date.parse(stored.body.savedAt) + 60_000).toISOString()
    await api(`/UserItems/${itemId}/UserData?userId=${userId}`, {
        method: 'POST', body: JSON.stringify({ PlaybackPositionTicks: 2_500_000, LastPlayedDate: later }),
    })
    await open(page)
    await until(async () => (await frameText(page)).includes(laterText),
        `a Jellyfin position saved after the stored one did not win: '${laterText}' is not shown`)
    pass(`a Jellyfin position saved after the stored one wins, showing '${laterText}'`)
} catch (error) {
    console.error(`FAIL: ${error.message}`)
    failed = true
} finally {
    // WebKit can hang while closing; the result is already known, so stop waiting.
    await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 10_000))])
}
process.exit(failed ? 1 : 0)
