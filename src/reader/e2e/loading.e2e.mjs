// Checks the loading screen while a book downloads, in the browser named by
// ORIEL_BROWSER: webkit at iPhone size with touch, or chromium at desktop size.
// The book's download is handed to the reader in four held-back steps (an
// in-page stream over the real response), and after each step the bar's share
// and the 'Downloading · <done> of <total> MB' line must match the bytes sent.
// The cover from Jellyfin and the title show; the logo and cover stack above
// the title on a phone and sit beside it on a desktop. Once the file has
// arrived the bar is full and the line reads 'Opening the book…' until the
// first page shows (held here by holding the reader's font list), and then
// the loading screen is gone. Run again with the size left out ('Downloading
// · <done> MB' and a bar without a share) and with no cover in the book's
// details (no cover shown). Nothing is requested from another host.
// Configured by environment: ORIEL_BASE (server URL including any BaseUrl),
// ORIEL_SERVER_ID, ORIEL_USER_ID, ORIEL_TOKEN, ORIEL_ITEM_ID (the test EPUB,
// whose cover Jellyfin has) and ORIEL_BROWSER. Exits non-zero on the first
// failed check.
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
    webkit: { engine: webkit, context: { ...devices['iPhone 13'] }, phone: true },
    chromium: { engine: chromium, context: { viewport: { width: 1280, height: 800 } }, phone: false },
}
const setup = setups[browserName]
if (!setup) {
    console.error(`FAIL: ORIEL_BROWSER is '${browserName}', expected webkit or chromium`)
    process.exit(2)
}

const STEPS = 4
const fail = message => { throw new Error(message) }
const pass = message => console.log(`PASS: ${browserName}: ${message}`)
const megabytes = bytes => (bytes / 1_000_000).toFixed(1)

// Wraps the page's fetch so the book's download reaches the reader in steps:
// the real response is read whole, then its bytes are handed on a step at a
// time as window.__orielStep() is called. With sized false the response
// carries no Content-Length.
const holdDownload = ({ itemId, steps, sized }) => {
    const realFetch = window.fetch.bind(window)
    const sent = { total: 0, done: 0, step: 0 }
    window.__orielSent = sent
    let next = () => {}
    window.__orielStep = () => next()
    window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input.url
        if (!url.includes(`/Items/${itemId}/Download`)) return realFetch(input, init)
        const response = await realFetch(input, init)
        const bytes = new Uint8Array(await response.arrayBuffer())
        sent.total = bytes.length
        const size = Math.ceil(bytes.length / steps)
        const headers = new Headers(response.headers)
        if (!sized) headers.delete('Content-Length')
        else headers.set('Content-Length', String(bytes.length))
        const body = new ReadableStream({
            pull: controller => new Promise(resolve => {
                next = () => {
                    const chunk = bytes.subarray(sent.done, sent.done + size)
                    sent.done += chunk.length
                    sent.step += 1
                    controller.enqueue(chunk)
                    if (sent.done >= bytes.length) controller.close()
                    resolve()
                }
            }),
        })
        return new Response(body, { status: response.status, headers })
    }
}

// What the loading screen shows.
const readScreen = page => page.evaluate(() => {
    const screen = document.getElementById('loading')
    const box = selector => {
        const element = screen.querySelector(selector)
        if (!element || element.hidden || getComputedStyle(element).display === 'none') return null
        const { left, top, right, bottom, width, height } = element.getBoundingClientRect()
        return { left, top, right, bottom, width, height }
    }
    const bar = screen.querySelector('.loading-bar')
    const cover = screen.querySelector('.loading-cover')
    return {
        shown: getComputedStyle(screen).display !== 'none',
        background: getComputedStyle(screen).backgroundColor,
        logo: box('.loading-logo'),
        cover: box('.loading-cover'),
        coverLoaded: cover.complete && cover.naturalWidth > 0,
        coverSrc: cover.getAttribute('src'),
        title: screen.querySelector('.loading-title').textContent,
        titleBox: box('.loading-title'),
        line: screen.querySelector('.loading-line').textContent,
        lineBox: box('.loading-line'),
        share: bar.getAttribute('aria-valuenow'),
        fill: bar.querySelector('span').getBoundingClientRect().width / bar.getBoundingClientRect().width,
        sent: { ...window.__orielSent },
        innerWidth,
    }
})

const run = async (browser, { sized, cover }) => {
    const context = await browser.newContext(setup.context)
    const elsewhere = []
    context.on('request', request => {
        const url = request.url()
        if (/^https?:/.test(url) && new URL(url).origin !== origin) elsewhere.push(url)
    })
    try {
        await context.addInitScript(value => {
            localStorage.setItem('jellyfin_credentials', value)
            localStorage.setItem('oriel-hints', JSON.stringify({ first: true, scroll: true }))
        }, credentials)
        await context.addInitScript(holdDownload, { itemId, steps: STEPS, sized })
        // The book's details without its cover, for a book Jellyfin has none for.
        if (!cover) {
            await context.route(`**/Items/${itemId}?*`, async route => {
                const response = await route.fetch()
                const details = await response.json()
                details.ImageTags = {}
                await route.fulfill({ response, json: details })
            })
        }
        // The reader's font list is held, so the book stays at 'Opening the book…'.
        let releaseFonts
        const fontsHeld = new Promise(resolve => { releaseFonts = resolve })
        await context.route('**/Oriel/Fonts', async route => {
            await fontsHeld
            await route.continue()
        })

        const page = await context.newPage()
        await page.goto(`${base}/Oriel/?id=${itemId}`)
        await page.waitForFunction(() => window.__orielSent?.total > 0, null, { timeout: 15_000 })
            .catch(() => fail('the reader never started the download'))
        const label = `${sized ? 'with' : 'without'} a size, ${cover ? 'with' : 'without'} a cover`

        // The title (and cover) arrive beside the download.
        await page.waitForFunction(() => document.querySelector('#loading .loading-title').textContent !== '', null, { timeout: 10_000 })
            .catch(() => fail('the loading screen never showed the title'))
        if (cover) {
            await page.waitForFunction(() => {
                const image = document.querySelector('#loading .loading-cover')
                return !image.hidden && image.complete && image.naturalWidth > 0
            }, null, { timeout: 10_000 }).catch(() => fail('the loading screen never showed the cover'))
        }

        // Every line the screen shows, since the last one is soon replaced.
        await page.evaluate(() => {
            const line = document.querySelector('#loading .loading-line')
            window.__orielLines = [line.textContent]
            new MutationObserver(() => window.__orielLines.push(line.textContent)).observe(line, { childList: true, characterData: true, subtree: true })
        })
        let total = 0
        for (let step = 0; step <= STEPS; step++) {
            if (step > 0) await page.evaluate(() => window.__orielStep())
            await page.waitForFunction(([wanted]) => window.__orielSent.step === wanted, [step], { timeout: 5_000 })
            const sent = await page.evaluate(() => ({ ...window.__orielSent }))
            total = sent.total
            const line = sized
                ? `Downloading · ${megabytes(sent.done)} of ${megabytes(sent.total)} MB`
                : `Downloading · ${megabytes(sent.done)} MB`
            const share = sized ? String(Math.floor(sent.done / sent.total * 100)) : null
            await page.waitForFunction(([text]) => window.__orielLines.includes(text), [line], { timeout: 5_000 })
                .catch(async () => fail(`after step ${step} of ${STEPS} (${sent.done} of ${sent.total} bytes) the line is not '${line}': ${JSON.stringify(await readScreen(page))}`))
            if (step === STEPS) break
            const screen = await readScreen(page)
            if (screen.share !== share) fail(`after step ${step} the bar's share is ${screen.share}, expected ${share}`)
            if (sized && Math.abs(screen.fill - sent.done / sent.total) > 0.02) fail(`after step ${step} the bar is ${Math.round(screen.fill * 100)}% full, expected ${share}%`)
        }
        pass(`${label}: the bar and line followed the ${STEPS} steps of the ${megabytes(total)} MB download ('${sized ? `Downloading · ${megabytes(total)} of ${megabytes(total)} MB` : `Downloading · ${megabytes(total)} MB`}')`)

        // Downloaded: the bar is full until the first page shows.
        await page.waitForFunction(() => document.querySelector('#loading .loading-line').textContent === 'Opening the book…', null, { timeout: 10_000 })
            .catch(async () => fail(`once downloaded the line is not 'Opening the book…': ${JSON.stringify(await readScreen(page))}`))
        const opening = await readScreen(page)
        if (!opening.shown || opening.share !== '100' || opening.fill < 0.99) fail(`while the book opens the bar is not full: ${JSON.stringify(opening)}`)
        if (opening.background !== 'rgb(16, 16, 16)') fail(`the loading screen is ${opening.background}, not #101010`)
        if (opening.title !== 'Oriel Smoke Book') fail(`the title is '${opening.title}'`)

        // The layout: on a phone the logo and cover stack above the title, bar and
        // line; on a desktop they sit to the left of them. A book without a cover
        // shows none.
        const { logo, cover: coverBox, titleBox, lineBox } = opening
        const centred = box => Math.abs(box.left + box.width / 2 - opening.innerWidth / 2) <= 2
        if (logo?.width !== 168) fail(`the logo is ${logo?.width} px wide`)
        if (cover) {
            if (!coverBox || !opening.coverLoaded || !/\/Items\/[^/]+\/Images\/Primary\?/.test(opening.coverSrc ?? '')) fail(`the cover from Jellyfin does not show: ${JSON.stringify(opening)}`)
            if (Math.round(coverBox.width) !== (setup.phone ? 150 : 180)) fail(`the cover is ${coverBox.width} px wide`)
        } else if (coverBox || opening.coverSrc) {
            fail(`a cover shows for a book that has none: ${JSON.stringify(opening)}`)
        }
        const art = coverBox ?? logo
        if (setup.phone) {
            if (!(logo.bottom <= (coverBox ?? titleBox).top && art.bottom <= titleBox.top && titleBox.bottom <= lineBox.top)) fail(`on a phone the logo and cover are not above the title and line: ${JSON.stringify(opening)}`)
            if (![logo, art, titleBox, lineBox].every(centred)) fail(`on a phone the loading screen is not centred: ${JSON.stringify(opening)}`)
        } else {
            if (!(logo.right <= titleBox.left && art.right <= titleBox.left)) fail(`on a desktop the logo and cover are not beside the title: ${JSON.stringify(opening)}`)
            if (!(titleBox.top < art.bottom && titleBox.bottom > logo.top)) fail(`on a desktop the title is not level with the logo and cover: ${JSON.stringify(opening)}`)
        }
        pass(`${label}: once downloaded the bar is full and the line reads 'Opening the book…', with the logo${cover ? ' and cover' : ''} ${setup.phone ? 'above' : 'beside'} '${opening.title}'${cover ? '' : ' and no cover'}`)

        releaseFonts()
        await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 }).catch(() => fail('the book did not render once its fonts were released'))
        if (await page.locator('#loading').isVisible()) fail('the loading screen is still up once the book shows')
        pass(`${label}: once the book shows, the loading screen is gone`)

        if (elsewhere.length) fail(`requests went to other hosts: ${[...new Set(elsewhere)].join(', ')}`)
    } finally {
        await context.close()
    }
}

const browser = await setup.engine.launch()
let failed = false
try {
    await run(browser, { sized: true, cover: true })
    await run(browser, { sized: false, cover: false })
    pass(`no request went to any host but ${origin}`)
} catch (error) {
    console.error(`FAIL: ${browserName}: ${error.message}`)
    failed = true
} finally {
    await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 10_000))])
}
process.exit(failed ? 1 : 0)
