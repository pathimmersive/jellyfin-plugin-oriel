// Checks Oriel's icons and loading screen in the browser named by ORIEL_BROWSER:
// webkit at iPhone size with touch, or chromium at desktop size with a mouse.
// The reader page names its favicon, apple-touch icon and web app manifest,
// each served by the plugin with its type; the manifest lists 192 and 512 px
// icons and a maskable one, each a PNG of its stated size. While the test EPUB
// downloads (held back here), the dark loading screen shows Oriel's logo with
// 'Loading the book…' in its line, and once the book shows the logo is gone.
// The cover, title and progress are checked by loading.e2e.mjs. Nothing is
// requested from another host.
// Configured by environment: ORIEL_BASE (server URL including any BaseUrl),
// ORIEL_SERVER_ID, ORIEL_USER_ID, ORIEL_TOKEN, ORIEL_ITEM_ID (the test EPUB)
// and ORIEL_BROWSER. Exits non-zero on the first failed check.
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
const itemId = env('ORIEL_ITEM_ID')
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

// A PNG's width and height, from its IHDR chunk.
const pngSize = bytes => {
    if (bytes.subarray(0, 4).toString('latin1') !== '\x89PNG') return null
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
}

const browser = await setup.engine.launch()
let failed = false
try {
    const context = await browser.newContext(setup.context)
    await context.addInitScript(value => {
        localStorage.setItem('jellyfin_credentials', value)
        localStorage.setItem('oriel-hints', JSON.stringify({ first: true, scroll: true }))
    }, credentials)
    const elsewhere = []
    context.on('request', request => {
        const url = request.url()
        if (/^https?:/.test(url) && new URL(url).origin !== origin) elsewhere.push(url)
    })
    // Hold the book back, so the loading screen stays up long enough to look at.
    let release
    const held = new Promise(resolve => { release = resolve })
    await context.route(`**/Items/${itemId}/Download**`, async route => {
        await held
        await route.continue()
    })

    const page = await context.newPage()
    await page.goto(`${base}/Oriel/?id=${itemId}`)
    await page.waitForSelector('body[data-state="loading"]', { timeout: 15_000 }).catch(() => fail('the reader never showed its loading state'))

    // The page names its icons and manifest, each served with its type.
    const links = await page.evaluate(() => [...document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]')]
        .map(link => ({ rel: link.rel, href: link.href, sizes: link.getAttribute('sizes') })))
    const want = [['icon', /favicon\.svg$/, 'image/svg+xml'], ['icon', /favicon-32\.png$/, 'image/png'], ['apple-touch-icon', /apple-touch-icon\.png$/, 'image/png'], ['manifest', /manifest\.webmanifest$/, 'application/manifest+json']]
    for (const [rel, file, type] of want) {
        const link = links.find(each => each.rel === rel && file.test(each.href))
        if (!link) fail(`the page names no ${rel} ${file}: ${JSON.stringify(links)}`)
        if (new URL(link.href).origin !== origin) fail(`${link.href} is not served by the plugin`)
        const response = await page.request.get(link.href)
        if (response.status() !== 200 || !(response.headers()['content-type'] ?? '').startsWith(type)) fail(`${link.href} answered ${response.status()} ${response.headers()['content-type']}`)
        const size = type === 'image/png' ? pngSize(await response.body()) : null
        if (file.test('favicon-32.png') && size?.join('x') !== '32x32') fail(`favicon-32.png is ${size?.join('x')}`)
        if (file.test('apple-touch-icon.png') && size?.join('x') !== '180x180') fail(`apple-touch-icon.png is ${size?.join('x')}`)
    }
    const manifestUrl = links.find(link => link.rel === 'manifest').href
    const manifest = await (await page.request.get(manifestUrl)).json()
    const icons = manifest.icons ?? []
    for (const [sizes, purpose] of [['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable']]) {
        const icon = icons.find(each => each.sizes === sizes && (each.purpose ?? 'any').split(' ').includes(purpose))
        if (!icon) fail(`the manifest lists no ${purpose} icon at ${sizes}: ${JSON.stringify(icons)}`)
        const response = await page.request.get(new URL(icon.src, manifestUrl).href)
        const size = pngSize(await response.body())
        if (response.status() !== 200 || size?.join('x') !== sizes) fail(`the manifest's ${purpose} ${sizes} icon answered ${response.status()} at ${size?.join('x')}`)
    }
    if (manifest.name !== 'Oriel') fail(`the manifest names the app '${manifest.name}'`)
    pass('the page names its favicon (SVG and 32 px), its 180 px apple-touch icon and its manifest, whose 192, 512 and maskable 512 px icons the plugin serves')

    // The loading screen: the logo on #101010, with the line under the bar.
    const loading = await page.evaluate(() => {
        const screen = document.getElementById('loading')
        const logo = screen?.querySelector('.loading-logo')
        const line = screen?.querySelector('.loading-line')
        if (!screen || !logo || !line) return null
        const box = logo.getBoundingClientRect()
        return {
            shown: getComputedStyle(screen).display !== 'none',
            background: getComputedStyle(screen).backgroundColor,
            loaded: logo.complete && logo.naturalWidth > 0,
            width: Math.round(box.width),
            line: line.textContent,
            lineShown: line.getBoundingClientRect().height > 0,
        }
    })
    if (!loading?.shown || !loading.loaded) fail(`the loading screen does not show the logo: ${JSON.stringify(loading)}`)
    if (loading.background !== 'rgb(16, 16, 16)') fail(`the loading screen is ${loading.background}, not #101010`)
    if (loading.width !== 168) fail(`the logo is ${loading.width} px wide`)
    if (loading.line !== 'Loading the book…' || !loading.lineShown) fail(`the loading screen's line is not 'Loading the book…': ${JSON.stringify(loading)}`)
    pass(`while the book downloads, the logo shows 168 px wide on #101010 with '${loading.line}'`)

    release()
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 }).catch(() => fail('the book did not render once released'))
    if (await page.locator('#loading').isVisible()) fail('the loading screen is still up once the book shows')
    pass('once the book shows, the loading screen is gone')

    if (elsewhere.length) fail(`requests went to other hosts: ${[...new Set(elsewhere)].join(', ')}`)
    pass(`no request went to any host but ${origin}`)
} catch (error) {
    console.error(`FAIL: ${browserName}: ${error.message}`)
    failed = true
} finally {
    await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 10_000))])
}
process.exit(failed ? 1 : 0)
