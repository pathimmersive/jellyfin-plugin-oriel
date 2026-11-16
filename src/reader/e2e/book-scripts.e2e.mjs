// Checks, in the browser named by ORIEL_BROWSER (webkit or chromium), that no
// script inside a book runs. The book made by make-scripted-epub.mjs tries an
// inline script, a script file inside the book, a script from another origin,
// onload and onerror handlers, a javascript: link, a frame's inline document,
// a refresh redirect and a script in an SVG section; each would record its
// name on the reader page or send a request to another origin. The reader
// page must carry Oriel's Content-Security-Policy, every section is opened and
// the javascript: link pressed, and then no marker is set, no request has left
// the origin, and no rendered section keeps a script element, an on* attribute,
// a srcdoc or a refresh. In the frames section, a script added to the shown
// section does not run (the policy holds inside the book's frames), the image
// and background from elsewhere are not fetched, jellyfin-web is not framed,
// the web link opens a tab that cannot reach back to the reader, and the link
// to an app's scheme opens nothing. Configured by environment:
// ORIEL_BASE (server URL including any BaseUrl), ORIEL_SERVER_ID,
// ORIEL_USER_ID, ORIEL_TOKEN, ORIEL_SCRIPTS_ID (the scripted EPUB) and
// ORIEL_BROWSER. Exits non-zero on the first failed check.
import { chromium, devices, webkit } from 'playwright'
import { pause } from './wait.mjs'

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

// What each rendered section still holds: script elements and on* attributes.
const leftovers = page => page.evaluate(() => {
    const renderer = document.querySelector('foliate-view')?.renderer
    return (renderer?.getContents?.() ?? []).map(({ doc, index }) => ({
        index,
        scripts: doc.querySelectorAll('script').length,
        handlers: [...doc.querySelectorAll('*')].flatMap(element =>
            [...element.attributes].filter(attribute => attribute.name.toLowerCase().startsWith('on')).map(attribute => `${element.localName}[${attribute.name}]`)),
        javascriptLinks: [...doc.querySelectorAll('[href]')].filter(element => /^\s*javascript:/i.test(element.getAttribute('href'))).length,
        srcdoc: doc.querySelectorAll('[srcdoc]').length,
        refresh: [...doc.querySelectorAll('meta[http-equiv]')].filter(meta => /refresh/i.test(meta.getAttribute('http-equiv'))).length,
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
    // The web link the check presses itself is meant to leave.
    const away = 'https://oriel-book-script.invalid/away'
    const elsewhere = []
    context.on('request', request => {
        const url = request.url()
        if (!url.startsWith(origin) && !url.startsWith('blob:') && !url.startsWith('data:') && url !== away) elsewhere.push(request)
    })
    // Chromium reports a load the Content-Security-Policy stopped as a request that failed with 'csp'; it never left.
    const stopped = new Set()
    context.on('requestfailed', request => { if (request.failure()?.errorText === 'csp') stopped.add(request) })
    const page = await context.newPage()
    // Tabs the book's links open, after the reader's own.
    const opened = []
    context.on('page', popup => opened.push(popup))
    const response = await page.goto(`${base}/Oriel/?id=${itemId}`)
    const policy = (await response.allHeaders())['content-security-policy'] ?? ''
    if (!/script-src 'self'(;|$)/.test(policy)) fail(`the reader page's Content-Security-Policy is '${policy}'`)
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 })
        .catch(() => fail('the reader did not render the scripted EPUB'))
    pass('the reader is served with a Content-Security-Policy that allows scripts only from its own files')

    // Every section, in turn, and the javascript: link in the handlers section.
    for (let index = 0; index < 6; index++) {
        // Not awaited: foliate-js's goTo can settle long after the section shows.
        await page.evaluate(i => { void document.querySelector('foliate-view').goTo(i) }, index)
        await page.waitForFunction(i => document.querySelector('foliate-view').renderer.getContents?.().some(contents => contents.index === i), index, { timeout: 10_000 })
            .catch(() => fail(`section ${index + 1} of the scripted EPUB did not open`))
        // A window in which nothing must happen: a book script on a timer or an onload handler gets its chance to run.
        await pause(800)
        if (index === 3) {
            const frame = page.frames().find(f => f.url().startsWith('blob:') && f !== page.mainFrame())
            const link = frame && await frame.$('#run')
            if (!link) fail('the handlers section has no link to press')
            await link.evaluate(element => element.click())
            // A window in which nothing must happen: the javascript: link gets its chance to run.
            await pause(500)
        }
        if (index === 4) {
            const frame = page.frames().find(f => f.url().startsWith('blob:') && f !== page.mainFrame() && f.parentFrame() === page.mainFrame())
            if (!frame || !await frame.$('#away')) fail('the frames section is not shown')
            // A script the check adds to the shown section itself, past any stripping: only the policy stops it.
            // So is a frame of jellyfin-web at its full address, which a book aimed at one server could name.
            await frame.evaluate(web => {
                const script = document.createElement('script')
                script.textContent = "(window.top.orielBookScripts = window.top.orielBookScripts || []).push('added-to-section')"
                document.body.append(script)
                const framed = document.createElement('iframe')
                framed.src = web
                document.body.append(framed)
            }, `${base}/web/index.html`)
            await pause(1500)
            // It has had its chance; the section's own scripts are what the leftovers check below counts.
            const framed = page.frames().filter(f => f.url().includes('/web/'))
            await frame.evaluate(() => document.querySelectorAll('script, iframe:not([id])').forEach(element => element.remove()))
            if (framed.length) fail(`jellyfin-web is framed inside the book: ${framed.map(f => f.url()).join(', ')}`)
            pass("in a book's frame, an added script does not run and jellyfin-web cannot be framed or redirected to")

            await (await frame.$('#away')).evaluate(element => element.click())
            const deadline = Date.now() + 10_000
            while (!opened.length && Date.now() < deadline) await pause(100)
            const tab = opened.shift() ?? fail('the web link in the book opened no tab')
            if (await tab.evaluate(() => window.opener !== null)) fail('the tab a book link opened can reach back to the reader through window.opener')
            await tab.close()
            await (await frame.$('#app')).evaluate(element => element.click())
            // A window in which nothing must happen: the link to an app's scheme gets its chance to open.
            await pause(1000)
            if (opened.length) fail(`a link to an app's scheme opened ${opened.map(p => p.url()).join(', ')}`)
            pass("a web link in the book opens a tab without window.opener, and a link to an app's scheme opens nothing")
        }
        const left = (await leftovers(page)).filter(section => section.scripts || section.handlers.length || section.javascriptLinks || section.srcdoc || section.refresh)
        if (left.length) fail(`section ${index + 1} keeps ${JSON.stringify(left)}`)
    }
    pass('every section of the scripted EPUB opens with no script element, on* attribute, javascript: link, srcdoc or refresh left in it')

    const ran = await page.evaluate(() => window.orielBookScripts ?? [])
    if (ran.length) fail(`scripts in the book ran: ${ran.join(', ')}`)
    const sent = elsewhere.filter(request => !stopped.has(request)).map(request => request.url())
    if (sent.length) fail(`the book sent requests to other origins: ${[...new Set(sent)].join(', ')}`)
    pass('no inline script, script file, script from elsewhere, onload, onerror, javascript: link, srcdoc or SVG script in the book ran, and nothing, not even an image or a background, left the origin')
    await page.close()
} catch (error) {
    console.error(`FAIL: ${browserName}: ${error.message}`)
    failed = true
} finally {
    // WebKit can hang while closing; the result is already known, so stop waiting.
    await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 10_000))])
}
process.exit(failed ? 1 : 0)
