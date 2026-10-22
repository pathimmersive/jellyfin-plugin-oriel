// Presses Play or Resume on a book's detail page in jellyfin-web, in Playwright
// WebKit, and checks which reader opens. Configured by environment: ORIEL_BASE
// (server URL including any BaseUrl), ORIEL_SERVER_ID, ORIEL_USER_ID,
// ORIEL_TOKEN, ORIEL_ITEM_ID; ORIEL_BUTTON, "Play" or "Resume", the title the
// play button must carry (Resume when the book has saved progress); and
// ORIEL_EXPECT: "oriel" for the Oriel reader at {base}/Oriel/?id=<item>, or
// "builtin" for jellyfin-web's own book player. Exits non-zero when the other
// one opens, neither does, or the button reads otherwise.
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
const expected = env('ORIEL_EXPECT')
const button = env('ORIEL_BUTTON')
if (button !== 'Play' && button !== 'Resume') {
    console.error(`FAIL: ORIEL_BUTTON is '${button}', expected Play or Resume`)
    process.exit(2)
}
if (expected !== 'oriel' && expected !== 'builtin') {
    console.error(`FAIL: ORIEL_EXPECT is '${expected}', expected oriel or builtin`)
    process.exit(2)
}

const credentials = JSON.stringify({
    Servers: [{
        Id: serverId,
        AccessToken: token,
        UserId: userId,
        // jellyfin-web connects to this address, so it carries any BaseUrl.
        ManualAddress: base,
        DateLastAccessed: Date.now(),
    }],
})

const orielUrl = `${new URL(base).pathname.replace(/\/$/, '')}/Oriel/?id=${itemId}`
const opened = async page => {
    const oriel = page.waitForURL(url => url.pathname + url.search === orielUrl, { timeout: 30_000 }).then(() => 'oriel')
    const builtin = page.waitForSelector('#bookPlayer', { timeout: 30_000 }).then(() => 'builtin')
    return Promise.any([oriel, builtin]).catch(() => 'nothing')
}

const browser = await webkit.launch()
let failed = false
try {
    const context = await browser.newContext()
    await context.addInitScript(value => {
        localStorage.setItem('jellyfin_credentials', value)
    }, credentials)
    const page = await context.newPage()
    const warnings = []
    page.on('console', message => {
        if (message.type() === 'warning' && message.text().includes('Oriel')) warnings.push(message.text())
    })

    await page.goto(`${base}/web/#/details?id=${itemId}`)
    const play = page.locator('.btnPlay:visible').first()
    await play.waitFor({ timeout: 30_000 }).catch(() => { throw new Error(`no Play button on the detail page (at ${page.url()})`) })
    const title = await play.getAttribute('title')
    if (title !== button) throw new Error(`the detail page's play button reads '${title}', expected ${button}`)
    await play.click()

    const result = await opened(page)
    if (result === 'oriel') {
        await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 })
    }
    if (result !== expected) {
        console.error(`FAIL: ${button} on ${itemId} opened ${result === 'nothing' ? 'no reader' : `the ${result} reader`}, expected ${expected} (at ${page.url()})`)
        failed = true
    } else if (warnings.length) {
        console.error(`FAIL: the launcher warned: ${warnings.join(' | ')}`)
        failed = true
    } else {
        console.log(`PASS: ${button} on the test EPUB at ${base}/web/ opens the ${expected === 'oriel' ? `Oriel reader at ${orielUrl}` : 'built-in book player'}`)
    }
} finally {
    await browser.close()
}
process.exit(failed ? 1 : 0)
