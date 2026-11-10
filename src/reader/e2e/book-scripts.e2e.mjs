// Checks, in the browser named by ORIEL_BROWSER (webkit or chromium), that no
// script inside a book runs. The book made by make-scripted-epub.mjs tries an
// inline script, a script file inside the book, a script from another origin,
// onload and onerror handlers, a javascript: link and a script in an SVG
// section; each would record its name on the reader page or send a request
// to another origin. The reader page must carry Oriel's Content-Security-
// Policy, every section is opened and the javascript: link pressed, and then
// no marker is set, no request has left the origin, and no rendered section
// keeps a script element or an on* attribute. Configured by environment:
// ORIEL_BASE (server URL including any BaseUrl), ORIEL_SERVER_ID,
// ORIEL_USER_ID, ORIEL_TOKEN, ORIEL_SCRIPTS_ID (the scripted EPUB) and
// ORIEL_BROWSER. Exits non-zero on the first failed check.
import { chromium, devices, webkit } from 'playwright'

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
const credentials = JSON.stringify({
    Servers: [{
        Id: env('ORIEL_SERVER_ID'),
        AccessToken: env('ORIEL_TOKEN'),
        UserId: env('ORIEL_USER_ID'),
        ManualAddress: origin,
        DateLastAccessed: Date.now(),
    }],
})
const itemId = env('ORIEL_SCRIPTS_ID')
const browserName = env('ORIEL_BROWSER')
const setups = {
    webkit: { engine: webkit, context: { ...devices['iPhone 13'] } },
    chromium: { engine: chromium, context: { viewport: { width: 1280, height: 800 } } },
}
const setup = setups[browserName]
if (!setup) {
    console.error(`FAIL: ORIEL_BROWSER is '${browserName}', expected webkit or chromium`)
    process.exit(2)
}

const fail = message => { throw new Error(message) }
const pass = message => console.log(`PASS: ${browserName}: ${message}`)
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

// What each rendered section still holds: script elements and on* attributes.
const leftovers = page => page.evaluate(() => {
    const renderer = document.querySelector('foliate-view')?.renderer
    return (renderer?.getContents?.() ?? []).map(({ doc, index }) => ({
        index,
        scripts: doc.querySelectorAll('script').length,
        handlers: [...doc.querySelectorAll('*')].flatMap(element =>
            [...element.attributes].filter(attribute => attribute.name.toLowerCase().startsWith('on')).map(attribute => `${element.localName}[${attribute.name}]`)),
        javascriptLinks: [...doc.querySelectorAll('[href]')].filter(element => /^\s*javascript:/i.test(element.getAttribute('href'))).length,
    }))
})

const browser = await setup.engine.launch()
let failed = false
try {
    const context = await browser.newContext(setup.context)
    await context.addInitScript(value => {
        localStorage.setItem('jellyfin_credentials', value)
        localStorage.setItem('oriel-hints', JSON.stringify({ first: true, scroll: true }))
    }, credentials)
    // Every request any frame makes; only Oriel's origin, blob: and data: may appear.
    const elsewhere = []
    context.on('request', request => {
        const url = request.url()
        if (!url.startsWith(origin) && !url.startsWith('blob:') && !url.startsWith('data:')) elsewhere.push(url)
    })
    const page = await context.newPage()
    const response = await page.goto(`${base}/Oriel/?id=${itemId}`)
    const policy = (await response.allHeaders())['content-security-policy'] ?? ''
    if (!/script-src 'self'(;|$)/.test(policy)) fail(`the reader page's Content-Security-Policy is '${policy}'`)
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 })
        .catch(() => fail('the reader did not render the scripted EPUB'))
    pass('the reader is served with a Content-Security-Policy that allows scripts only from its own files')

    // Every section, in turn, and the javascript: link in the handlers section.
    for (let index = 0; index < 5; index++) {
        // Not awaited: foliate-js's goTo can settle long after the section shows.
        await page.evaluate(i => { void document.querySelector('foliate-view').goTo(i) }, index)
        await page.waitForFunction(i => document.querySelector('foliate-view').renderer.getContents?.().some(contents => contents.index === i), index, { timeout: 10_000 })
            .catch(() => fail(`section ${index + 1} of the scripted EPUB did not open`))
        await pause(800)
        if (index === 3) {
            const frame = page.frames().find(f => f.url().startsWith('blob:') && f !== page.mainFrame())
            const link = frame && await frame.$('#run')
            if (!link) fail('the handlers section has no link to press')
            await link.evaluate(element => element.click())
            await pause(500)
        }
        const left = (await leftovers(page)).filter(section => section.scripts || section.handlers.length || section.javascriptLinks)
        if (left.length) fail(`section ${index + 1} keeps ${JSON.stringify(left)}`)
    }
    pass('every section of the scripted EPUB opens with no script element, no on* attribute and no javascript: link left in it')

    const ran = await page.evaluate(() => window.orielBookScripts ?? [])
    if (ran.length) fail(`scripts in the book ran: ${ran.join(', ')}`)
    if (elsewhere.length) fail(`the book sent requests to other origins: ${[...new Set(elsewhere)].join(', ')}`)
    pass('no inline script, script file, script from elsewhere, onload, onerror, javascript: link or SVG script in the book ran, and nothing left the origin')
    await page.close()
} catch (error) {
    console.error(`FAIL: ${browserName}: ${error.message}`)
    failed = true
} finally {
    await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 10_000))])
}
process.exit(failed ? 1 : 0)
