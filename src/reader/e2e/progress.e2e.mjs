// Checks jellyfin-web against a book that has saved progress, in Playwright
// WebKit: the home page's Continue Reading row lists it, and Resume on its
// detail page opens the built-in book player at the saved chapter. Configured
// by environment: ORIEL_BASE (server URL including any BaseUrl),
// ORIEL_SERVER_ID, ORIEL_USER_ID, ORIEL_TOKEN, ORIEL_ITEM_ID, and
// ORIEL_EXPECT_TEXT, a line of the chapter the saved position falls in.
// Exits non-zero on the first failed check.
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
const expectText = env('ORIEL_EXPECT_TEXT')

const credentials = JSON.stringify({
    Servers: [{
        Id: serverId,
        AccessToken: token,
        UserId: userId,
        ManualAddress: base,
        DateLastAccessed: Date.now(),
    }],
})

const fail = message => { throw new Error(message) }
const pass = message => console.log(`PASS: ${message}`)

// The built-in reader renders each chapter in an iframe, so read every frame.
const frameText = async page => {
    const texts = await Promise.all(page.frames().map(frame =>
        frame.evaluate(() => document.body?.innerText ?? '').catch(() => '')))
    return texts.join('\n')
}

const browser = await webkit.launch()
let failed = false
try {
    const context = await browser.newContext()
    await context.addInitScript(value => {
        localStorage.setItem('jellyfin_credentials', value)
    }, credentials)
    const page = await context.newPage()

    await page.goto(`${base}/web/#/home`)
    // A home section is a heading followed by its cards, inside one element.
    const row = page.locator('h2.sectionTitle', { hasText: 'Continue Reading' }).locator('..')
    await row.locator(`[data-id="${itemId}"]`).first().waitFor({ timeout: 30_000 })
        .catch(() => fail(`the home page has no Continue Reading card for ${itemId}`))
    pass(`the home page's Continue Reading row lists the book with saved progress`)

    await page.goto(`${base}/web/#/details?id=${itemId}`)
    const resume = page.locator('.btnPlay:visible').first()
    await resume.waitFor({ timeout: 30_000 }).catch(() => fail('no Play button on the detail page'))
    const title = await resume.getAttribute('title')
    if (title !== 'Resume') fail(`the detail page's play button reads '${title}', expected Resume`)
    await resume.click()

    await page.waitForSelector('#bookPlayer', { timeout: 30_000 })
        .catch(() => fail(`Resume did not open the built-in book player (at ${page.url()})`))
    let text = ''
    for (let i = 0; i < 30 && !text.includes(expectText); i++) {
        await page.waitForTimeout(1000)
        text = await frameText(page)
    }
    if (!text.includes(expectText)) {
        fail(`Resume opened the built-in book player, but not at the saved chapter: '${expectText}' is not shown (showing '${text.trim().slice(0, 80)}')`)
    }
    pass(`Resume opens the built-in book player at the saved chapter`)
} catch (error) {
    console.error(`FAIL: ${error.message}`)
    failed = true
} finally {
    await browser.close()
}
process.exit(failed ? 1 : 0)
