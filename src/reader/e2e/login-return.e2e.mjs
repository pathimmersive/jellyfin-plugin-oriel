// Checks where a signed-out visitor ends up after signing in, in Playwright
// WebKit: it opens the reader at /Oriel/?id=<book> (ORIEL_START=book, the
// default) or the reading data page at /Oriel/data.html?id=<book>
// (ORIEL_START=data) with no jellyfin-web session, signs in on the jellyfin-web
// login page it is sent to, and expects the book's detail page
// (ORIEL_EXPECT=details), the book in Oriel (ORIEL_EXPECT=oriel), the Jellyfin
// home page (ORIEL_EXPECT=home) or the reading data page (ORIEL_EXPECT=data).
// Configured by environment: ORIEL_BASE (server URL including any BaseUrl),
// ORIEL_ITEM_ID, ORIEL_USER, ORIEL_PASSWORD, ORIEL_EXPECT, ORIEL_START and, for
// ORIEL_EXPECT=oriel, ORIEL_EXPECT_TEXT, a line of the book's first chapter.
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
const itemId = env('ORIEL_ITEM_ID')
const user = env('ORIEL_USER')
const password = env('ORIEL_PASSWORD')
const expect = env('ORIEL_EXPECT')
const expectText = expect === 'oriel' ? env('ORIEL_EXPECT_TEXT') : ''
const start = process.env.ORIEL_START ?? 'book'

const fail = message => { throw new Error(message) }
const pass = message => console.log(`PASS: ${message}`)

const frameText = async page => {
    const texts = await Promise.all(page.frames().map(frame =>
        frame.evaluate(() => document.body?.innerText ?? '').catch(() => '')))
    return texts.join('\n')
}

const browser = await webkit.launch()
let failed = false
try {
    const page = await (await browser.newContext()).newPage()
    const webPath = `${new URL(base).pathname.replace(/\/$/, '')}/web/`

    await page.goto(start === 'data' ? `${base}/Oriel/data.html?id=${itemId}` : `${base}/Oriel/?id=${itemId}`)
    await page.waitForURL(url => url.pathname === webPath && url.hash.startsWith('#/login'), { timeout: 15_000 })
        .catch(() => fail(`the signed-out ${start} page did not go to ${webPath}#/login (at ${page.url()})`))

    // The login page shows user cards or the manual form; use the manual form.
    // While it loads, the page can switch between the two and re-render its
    // buttons, so keep pressing whichever Manual Login button is showing until
    // the manual form is.
    const name = page.locator('#txtManualName')
    const deadline = Date.now() + 30_000
    while (!(await name.isVisible())) {
        if (Date.now() > deadline) fail('the manual login form never appeared on the login page')
        await page.evaluate(() => {
            const button = [...document.querySelectorAll('.btnManual')]
                .find(element => !element.classList.contains('hide') && element.offsetParent !== null)
            button?.click()
        })
        await page.waitForTimeout(500)
    }
    const firstLine = error => error.message.split('\n')[0]
    await name.fill(user, { timeout: 10_000 })
        .catch(error => fail(`could not enter the user name: ${firstLine(error)}`))
    await page.locator('#txtManualPassword').fill(password, { timeout: 10_000 })
        .catch(error => fail(`could not enter the password: ${firstLine(error)}`))
    await page.locator('#txtManualPassword').press('Enter')

    if (expect === 'details') {
        await page.waitForURL(url => url.pathname === webPath && url.hash.startsWith('#/details') &&
            new URLSearchParams(url.hash.split('?')[1] ?? '').get('id') === itemId, { timeout: 30_000 })
            .catch(() => fail(`signing in did not open the book's detail page (at ${page.url()})`))
        pass(`signing in from the signed-out reader at ${base} opens the book's detail page`)
    } else if (expect === 'home') {
        await page.waitForURL(url => url.pathname === webPath && url.hash.startsWith('#/home'), { timeout: 30_000 })
            .catch(() => fail(`signing in did not reach the Jellyfin home page (at ${page.url()})`))
        // Long enough for anything that would move on from home to have done so.
        await page.waitForTimeout(2000)
        if (!new URL(page.url()).hash.startsWith('#/home')) fail(`after signing in the page moved on to ${page.url()}`)
        pass(`signing in from the signed-out ${start} page at ${base} stays on the Jellyfin home page`)
    } else if (expect === 'data') {
        await page.waitForURL(url => url.pathname.toLowerCase().endsWith('/oriel/data.html') && url.searchParams.get('id') === itemId,
            { timeout: 30_000 })
            .catch(() => fail(`signing in did not return to the reading data page (at ${page.url()})`))
        await page.getByRole('heading', { level: 1, name: 'Your reading data' }).waitFor({ timeout: 15_000 })
            .catch(() => fail('the reading data page opened after signing in but did not show its heading'))
        pass(`signing in from the signed-out reading data page at ${base} returns to it`)
    } else {
        await page.waitForURL(url => url.pathname.toLowerCase().endsWith('/oriel/') && url.searchParams.get('id') === itemId,
            { timeout: 30_000 })
            .catch(() => fail(`signing in did not return to the book in Oriel (at ${page.url()})`))
        let text = ''
        for (let i = 0; i < 30 && !text.includes(expectText); i++) {
            await page.waitForTimeout(1000)
            text = await frameText(page)
        }
        if (!text.includes(expectText)) fail(`Oriel opened after signing in but the book did not render`)
        pass(`signing in from the signed-out reader at ${base} returns to the book in Oriel`)
    }
} catch (error) {
    console.error(`FAIL: ${error.message}`)
    failed = true
} finally {
    // WebKit can hang while closing; the result is already known, so stop waiting.
    await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 10_000))])
}
process.exit(failed ? 1 : 0)
