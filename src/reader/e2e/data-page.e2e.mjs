// Checks the Your reading data page at /Oriel/data.html in Playwright WebKit,
// at a phone and a desktop width: its sections and the Import button disabled
// until a file is chosen; Download reading data saving the export under the
// server's file name; importing a file and the Import finished summary (places
// imported, kept, and books that matched nothing); the alert for a file that is
// not Oriel reading data, which leaves the stored position as it was; and Back
// to the book with and without a book id. Expects the signed-in user to have a
// stored position in ORIEL_ITEM_ID. Configured by environment: ORIEL_BASE
// (server URL including any BaseUrl), ORIEL_SERVER_ID, ORIEL_USER_ID,
// ORIEL_TOKEN and ORIEL_ITEM_ID. Exits non-zero on the first failed check.
import { readFile } from 'node:fs/promises'
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
const token = env('ORIEL_TOKEN')
const itemId = env('ORIEL_ITEM_ID')
const credentials = JSON.stringify({
    Servers: [{
        Id: env('ORIEL_SERVER_ID'),
        AccessToken: token,
        UserId: env('ORIEL_USER_ID'),
        ManualAddress: new URL(base).origin,
        DateLastAccessed: Date.now(),
    }],
})
const basePath = new URL(base).pathname.replace(/\/$/, '')
const authorization = `MediaBrowser Client="oriel-smoke", Device="smoke", DeviceId="oriel-smoke", Version="1.0.0", Token="${token}"`

const fail = message => { throw new Error(message) }
const pass = message => console.log(`PASS: ${message}`)

const storedPosition = async () => {
    const response = await fetch(`${base}/Oriel/Positions/${itemId}`, { headers: { Authorization: authorization } })
    return response.ok ? (await response.json()).cfi : null
}

const openPage = async (context, query = `?id=${itemId}`) => {
    const page = await context.newPage()
    const response = await page.goto(`${base}/Oriel/data.html${query}`)
    if (!response?.ok()) fail(`GET ${base}/Oriel/data.html returned ${response?.status()}`)
    await page.getByRole('heading', { level: 1, name: 'Your reading data' }).waitFor({ timeout: 15_000 })
        .catch(() => fail('the page has no Your reading data heading'))
    return page
}

// Chooses a file with the given JSON content and presses Import.
const importFile = async (page, name, content) => {
    await page.locator('input[type="file"]').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(content) })
    if (!await page.getByText(name, { exact: true }).isVisible()) fail(`the chosen file's name ${name} is not shown`)
    const button = page.getByRole('button', { name: 'Import', exact: true })
    if (await button.isDisabled()) fail('Import is still disabled after choosing a file')
    await button.click()
}

const panelText = async (page, role) => {
    const panel = page.getByRole(role)
    await panel.waitFor({ timeout: 15_000 }).catch(() => fail(`no ${role} appeared after Import`))
    return (await panel.innerText()).replace(/\s+/g, ' ').trim()
}

const browser = await webkit.launch()
let failed = false
try {
    for (const [label, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 800 }]]) {
        const context = await browser.newContext({ viewport, acceptDownloads: true })
        await context.addInitScript(value => {
            localStorage.setItem('jellyfin_credentials', value)
        }, credentials)
        const page = await openPage(context)

        for (const name of ['Export', 'Import']) {
            await page.getByRole('heading', { level: 2, name }).waitFor({ timeout: 5_000 }).catch(() => fail(`no ${name} section`))
        }
        if (!await page.getByText('Choose a file', { exact: true }).isVisible()) fail('no Choose a file control')
        if (!await page.getByText('No file chosen', { exact: true }).isVisible()) fail('no "No file chosen" before a file is chosen')
        if (!await page.getByRole('button', { name: 'Import', exact: true }).isDisabled()) fail('Import is enabled before a file is chosen')
        const download = page.getByRole('link', { name: 'Download reading data' })
        const main = await page.locator('main').boundingBox()
        const button = await download.boundingBox()
        if (!main || !button) fail('the page has no main column or download button')
        if (main.width > 720 + 1) fail(`the main column is ${main.width}px wide, more than 720px`)
        const fullWidth = button.width > main.width - 48
        if (label === 'phone' && !fullWidth) fail(`at phone width the download button is ${button.width}px of a ${main.width}px column, not full width`)
        if (label === 'desktop' && fullWidth) fail('at desktop width the download button spans the column instead of sitting at the left')
        pass(`${label}: the page shows Export and Import, Import is disabled until a file is chosen, and the buttons follow the ${label} layout`)

        if (label === 'phone') {
            await context.close()
            continue
        }

        // Download reading data saves the export under the server's file name.
        const [saved] = await Promise.all([page.waitForEvent('download', { timeout: 15_000 }), download.click()])
        const fileName = saved.suggestedFilename()
        if (!/^oriel-reading-data-\d{4}-\d{2}-\d{2}\.json$/.test(fileName)) fail(`the download is named ${fileName}`)
        const exported = JSON.parse(await readFile(await saved.path(), 'utf8'))
        if (exported.format !== 'oriel-reading-data' || !Array.isArray(exported.positions)) fail('the download is not Oriel reading data')
        const entry = exported.positions.find(p => p.itemId.replaceAll('-', '').toLowerCase() === itemId.toLowerCase())
        if (!entry) fail('the download has no position for the test book')
        pass(`Download reading data saves ${fileName} with ${exported.positions.length} position(s)`)

        // A file with a newer place in the test book and a book this server lacks.
        const newerCfi = 'epubcfi(/6/8!/4/2/1:0)'
        const newer = {
            ...exported,
            positions: [
                { ...entry, cfi: newerCfi, savedAt: new Date(Date.parse(entry.savedAt) + 1000).toISOString() },
                { itemId: '00000000000040008000000000000003', title: 'A Book This Server Lacks', authors: ['Nobody', 'Someone'], fileName: 'lacking.epub', cfi: 'epubcfi(/6/2!/4/2/1:0)', fraction: 0.1, savedAt: entry.savedAt },
            ],
        }
        await importFile(page, 'newer.json', JSON.stringify(newer))
        let text = await panelText(page, 'status')
        for (const expected of [
            'Import finished',
            '1 place imported',
            '1 book is not in your library here, so its place was not imported:',
            'A Book This Server Lacks',
            'Nobody, Someone · lacking.epub',
            'Add these books to Jellyfin, then import the same file again to bring their places back.',
        ]) {
            if (!text.includes(expected)) fail(`the Import finished panel lacks "${expected}": ${text}`)
        }
        if (text.includes('kept')) fail(`the panel reports kept places when none were kept: ${text}`)
        if (await storedPosition() !== newerCfi) fail('importing a newer place did not store it')
        pass('importing a newer place and an unknown book shows 1 place imported and lists the book with its authors and file name')

        // The exported file is now older than what is stored: kept.
        await importFile(page, fileName, JSON.stringify(exported))
        text = await panelText(page, 'status')
        if (!text.includes(`${exported.positions.length} kept as ${exported.positions.length === 1 ? 'it was' : 'they were'}, because you had read further on this server`)) {
            fail(`importing an older file does not report the kept places: ${text}`)
        }
        if (text.includes('imported:') || /\d+ places? imported/.test(text)) fail(`the panel reports imported places when none were: ${text}`)
        if (await storedPosition() !== newerCfi) fail('importing an older file changed the stored place')
        pass('importing an older file reports the places kept because the user had read further, and changes nothing')

        // A file that is not Oriel reading data.
        await importFile(page, 'reading-list.json', JSON.stringify({ books: ['Emma'] }))
        text = await panelText(page, 'alert')
        for (const expected of [
            'That file is not Oriel reading data, so nothing was imported.',
            'Choose a file you downloaded with Export. Your places on this server have not changed.',
        ]) {
            if (!text.includes(expected)) fail(`the alert lacks "${expected}": ${text}`)
        }
        if (await page.getByRole('status').isVisible()) fail('the earlier Import finished panel is still showing next to the alert')
        if (await storedPosition() !== newerCfi) fail('a rejected file changed the stored place')
        pass('a file that is not Oriel reading data shows the alert and leaves the stored place as it was')

        // Back to the book, with and without a book id.
        const back = page.getByRole('link', { name: 'Back to the book' })
        const withId = new URL(await back.getAttribute('href'), page.url())
        if (withId.pathname !== `${basePath}/Oriel/` || withId.searchParams.get('id') !== itemId) fail(`Back to the book leads to ${withId}`)
        const noBook = await openPage(context, '')
        const withoutId = new URL(await noBook.getByRole('link', { name: 'Back to the book' }).getAttribute('href'), noBook.url())
        if (withoutId.pathname !== `${basePath}/web/`) fail(`without a book, Back to the book leads to ${withoutId}`)
        pass(`Back to the book returns to ${withId.pathname}${withId.search}, or to ${withoutId.pathname} without a book`)
        await context.close()
    }

    // A signed-out visitor is sent to the jellyfin-web sign-in page.
    const page = await (await browser.newContext()).newPage()
    await page.goto(`${base}/Oriel/data.html?id=${itemId}`)
    await page.waitForURL(url => url.pathname === `${basePath}/web/` && url.hash.startsWith('#/login'), { timeout: 15_000 })
        .catch(() => fail(`the signed-out page did not go to the sign-in page (at ${page.url()})`))
    pass('a signed-out visitor is sent to the jellyfin-web sign-in page')
} catch (error) {
    console.error(`FAIL: ${error.message}`)
    failed = true
} finally {
    // WebKit can hang while closing; the result is already known, so stop waiting.
    await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 10_000))])
}
process.exit(failed ? 1 : 0)
