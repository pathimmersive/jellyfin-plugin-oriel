// Checks where a signed-out reader ends up after signing in, in Playwright
// WebKit: it opens /Oriel/?id=<book> with no jellyfin-web session, signs in on
// the jellyfin-web login page it is sent to, and expects either the book's
// detail page (ORIEL_EXPECT=details) or the book in Oriel (ORIEL_EXPECT=oriel).
// Configured by environment: ORIEL_BASE (server URL including any BaseUrl),
// ORIEL_ITEM_ID, ORIEL_USER, ORIEL_PASSWORD, ORIEL_EXPECT and
// ORIEL_EXPECT_TEXT, a line of the book's first chapter.
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
const expectText = env('ORIEL_EXPECT_TEXT')

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

    await page.goto(`${base}/Oriel/?id=${itemId}`)
    await page.waitForURL(url => url.pathname === webPath && url.hash.startsWith('#/login'), { timeout: 15_000 })
        .catch(() => fail(`the signed-out reader did not go to ${webPath}#/login (at ${page.url()})`))

    // The login page shows user cards or the manual form; use the manual form.
    const name = page.locator('#txtManualName')
    await page.locator('#txtManualName:visible, .btnManual:visible').first().waitFor({ timeout: 30_000 })
        .catch(() => fail('the login page offers neither the manual form nor its button'))
    const firstLine = error => error.message.split('\n')[0]
    if (!(await name.isVisible())) {
        // The user cards can still be animating in on a slow runner, so fire the
        // button's click handler directly rather than waiting for it to settle.
        await page.locator('.btnManual:visible').first().dispatchEvent('click')
            .catch(error => fail(`could not open the manual login form: ${firstLine(error)}`))
        await name.waitFor({ state: 'visible', timeout: 10_000 })
            .catch(error => fail(`the manual login form did not appear: ${firstLine(error)}`))
    }
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
    await browser.close()
}
process.exit(failed ? 1 : 0)
