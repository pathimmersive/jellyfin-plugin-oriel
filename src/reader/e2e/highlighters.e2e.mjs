// Checks your own highlighters in the browser named by ORIEL_BROWSER: webkit at
// iPhone size with touch, or chromium at desktop size with a mouse. Preferences
// lists the four built-ins with a count and Add a highlighter; the New
// highlighter sheet adds one, which the Selected text toolbar then offers;
// Edit changes a built-in's name and colour and its highlights are redrawn;
// the arrows and a drag by the handle reorder them, and the toolbar follows;
// the toolbar's + adds one and highlights the selection in it; Delete asks
// first and turns its highlights into Quotes highlights; at 8 there is no
// more Add; and another browser sees the same list. The server keeps them for
// the user. Configured by environment: ORIEL_BASE (server URL including any
// BaseUrl), ORIEL_SERVER_ID, ORIEL_USER_ID, ORIEL_TOKEN, ORIEL_ITEM_ID (the
// test EPUB) and ORIEL_BROWSER. Exits non-zero on the first failed check.
import { chromium, devices, webkit } from 'playwright'
import { press } from './press.mjs'

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
const token = env('ORIEL_TOKEN')
const credentials = JSON.stringify({
    Servers: [{
        Id: env('ORIEL_SERVER_ID'),
        AccessToken: token,
        UserId: env('ORIEL_USER_ID'),
        ManualAddress: origin,
        DateLastAccessed: Date.now(),
    }],
})
const itemId = env('ORIEL_ITEM_ID')
const browserName = env('ORIEL_BROWSER')
const setups = {
    webkit: { engine: webkit, context: { ...devices['iPhone 13'] }, touch: true },
    chromium: { engine: chromium, context: { viewport: { width: 1280, height: 800 } }, touch: false },
}
const setup = setups[browserName]
if (!setup) {
    console.error(`FAIL: ORIEL_BROWSER is '${browserName}', expected webkit or chromium`)
    process.exit(2)
}

const fail = message => { throw new Error(message) }
const pass = message => console.log(`PASS: ${browserName}: ${message}`)
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

// Presses a button or link as this screen's reader would: a tap on a touch screen, else a click.
const use = locator => setup.touch ? locator.tap() : locator.click()

// The server's highlighters and highlights, as the user; and putting both back as they were.
const authorization = `MediaBrowser Client="oriel-e2e", Device="e2e", DeviceId="oriel-e2e-highlighters", Version="1.0.0", Token="${token}"`
const call = async (path, init = {}) => {
    const response = await fetch(`${base}${path}`, { ...init, headers: { Authorization: authorization, 'Content-Type': 'application/json', ...init.headers } })
    if (!response.ok) fail(`${init.method ?? 'GET'} ${path} returned ${response.status}`)
    return response.status === 204 ? null : response.json()
}
const BUILT_INS = [['yellow', 'Quotes', '#ffd54f'], ['green', 'Green', '#81c784'], ['blue', 'Vocabulary', '#64b5f6'], ['pink', 'Pink', '#f06292']]
const highlighters = () => call('/Oriel/Highlighters')
const putHighlighters = list => call('/Oriel/Highlighters', { method: 'PUT', body: JSON.stringify(list) })
const highlights = () => call(`/Oriel/Highlights/${itemId}`)
const reset = async () => {
    for (const highlight of await highlights()) await call(`/Oriel/Highlights/${itemId}/${highlight.id}`, { method: 'DELETE' })
    await putHighlighters(BUILT_INS.map(([id, name, colour]) => ({ id, name, colour })))
}

const open = async context => {
    const page = await context.newPage()
    await page.goto(`${base}/Oriel/?id=${itemId}`)
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 })
        .catch(() => fail('the reader did not render the book'))
    await pause(1500)
    return page
}

const showControls = async page => {
    if (await page.locator('#controls header').isVisible()) return
    if (!await press(page, 0.5, setup.touch)) fail('no frame shows the page to tap')
    await pause(600)
}

const openPrefs = async page => {
    await showControls(page)
    await use(page.getByRole('button', { name: 'Preferences' }))
    await pause(400)
    const panel = page.locator('#prefs')
    if (!await panel.isVisible()) fail('Preferences did not open')
    return panel
}

const closeAll = async page => {
    for (let i = 0; i < 3; i++) {
        await page.keyboard.press('Escape')
        await pause(250)
    }
}

// Preferences' Highlighters group: its count, and each row's name, whether it says Default colour, and its buttons.
const prefsList = async page => {
    const group = page.locator('#prefs').getByRole('group', { name: 'Highlighters' })
    return {
        count: (await group.locator('.count').innerText()).trim(),
        rows: await group.locator('li').evaluateAll(items => items.map(item => ({
            name: item.querySelector('.name span')?.textContent?.trim() ?? '',
            builtIn: !!item.querySelector('.default'),
            buttons: [...item.querySelectorAll('button')].map(button => button.getAttribute('aria-label')),
        }))),
        add: await group.getByRole('button', { name: 'Add a highlighter' }).isVisible(),
    }
}

// Selects `words` in the paragraph starting `paragraph` of the section shown, as a long press leaves it.
const select = async (page, paragraph, words) => {
    const found = await page.evaluate(({ paragraph, words }) => {
        const { doc } = document.querySelector('foliate-view').renderer.getContents()[0]
        const text = [...doc.querySelectorAll('p')].find(each => each.textContent.startsWith(paragraph))?.firstChild
        const at = text?.textContent.indexOf(words) ?? -1
        if (at < 0) return false
        const range = doc.createRange()
        range.setStart(text, at)
        range.setEnd(text, at + words.length)
        doc.getSelection().removeAllRanges()
        doc.getSelection().addRange(range)
        return true
    }, { paragraph, words })
    if (!found) fail(`'${words}' is not on the page`)
    await pause(800)
}

const toolbar = page => page.getByRole('toolbar', { name: 'Selected text' })
const toolbarNames = async page => (await toolbar(page).getByRole('group', { name: 'Highlighters' }).getByRole('button').evaluateAll(items =>
    items.map(item => item.getAttribute('aria-label'))))

// The highlights drawn on the page: each one's highlighter and colour.
const drawn = page => page.evaluate(() => document.querySelector('foliate-view').renderer.getContents()
    .flatMap(({ overlayer }) => [...overlayer?.element.querySelectorAll('g[data-colour]') ?? []])
    .map(group => ({ colour: group.getAttribute('data-colour'), fill: group.getAttribute('fill') })))

const sheet = (page, name) => page.getByRole('region', { name })
const sheetState = async (page, name) => ({
    name: await sheet(page, name).getByRole('textbox', { name: 'Name (optional)' }).inputValue(),
    checked: await sheet(page, name).getByRole('radiogroup', { name: 'Colour' }).getByRole('radio', { checked: true }).getAttribute('aria-label'),
})

const FIRST = ['Paragraph 1 holds', 'plain filler text']
const SECOND = ['Paragraph 2 holds', 'every chapter']
const THIRD = ['Paragraph 3 holds', 'about the same length']

const browser = await setup.engine.launch()
let failed = false
try {
    await reset()
    const context = await browser.newContext(setup.context)
    await context.addInitScript(value => {
        localStorage.setItem('jellyfin_credentials', value)
        // The reading gestures hint was seen on this device before.
        localStorage.setItem('oriel-hints', JSON.stringify({ first: true, scroll: true }))
    }, credentials)
    const page = await open(context)
    await showControls(page)
    await use(page.getByRole('button', { name: 'Contents' }))
    await pause(400)
    await use(page.locator('#contents').getByRole('link', { name: /^Chapter One/ }))
    await pause(1500)

    // Preferences lists the built-ins.
    await openPrefs(page)
    let list = await prefsList(page)
    const builtInButtons = name => [`Move ${name}`, `Edit ${name}`]
    if (list.count !== '4 of 8' || !list.add || JSON.stringify(list.rows) !== JSON.stringify(BUILT_INS.map(([, name]) => ({ name, builtIn: true, buttons: builtInButtons(name) })))) {
        fail(`Preferences' Highlighters shows ${JSON.stringify(list)}`)
    }
    const note = (await page.locator('#prefs .note').innerText()).trim()
    const device = setup.touch ? 'phone' : 'computer'
    if (note !== `Size, spacing, margins and page turn apply to this ${device}. Themes, fonts and highlighters follow you on every device.`) fail(`the Preferences note reads '${note}'`)
    pass(`Preferences lists the four built-ins (${list.count}), each with Move and Edit, and Add a highlighter`)

    // Add a highlighter from Preferences.
    await use(page.locator('#prefs').getByRole('button', { name: 'Add a highlighter' }))
    await pause(400)
    if (!await sheet(page, 'New highlighter').isVisible()) fail('Add a highlighter did not open the New highlighter sheet')
    let state = await sheetState(page, 'New highlighter')
    if (state.name !== '' || state.checked !== 'Orange') fail(`a new highlighter starts as ${JSON.stringify(state)}`)
    await sheet(page, 'New highlighter').getByRole('textbox', { name: 'Name (optional)' }).fill('Questions')
    await use(sheet(page, 'New highlighter').getByRole('radio', { name: 'Lavender' }))
    await use(sheet(page, 'New highlighter').getByRole('button', { name: 'Add highlighter' }))
    await pause(1000)
    if (await sheet(page, 'New highlighter').isVisible()) fail('Add highlighter left the sheet open')
    let kept = await highlighters()
    const questions = kept.find(highlighter => highlighter.name === 'Questions')
    if (kept.length !== 5 || questions?.colour !== '#b39ddb' || questions.builtIn) fail(`the server keeps ${JSON.stringify(kept)}`)
    list = await prefsList(page)
    if (list.count !== '5 of 8' || JSON.stringify(list.rows.at(-1)) !== JSON.stringify({ name: 'Questions', builtIn: false, buttons: ['Move Questions', 'Edit Questions', 'Delete Questions'] })) fail(`after adding, Preferences shows ${JSON.stringify(list)}`)
    pass('the New highlighter sheet starts on the first unused colour and adds Questions in lavender, kept on the server and listed with Delete')

    // The toolbar offers it, and highlights in it.
    await closeAll(page)
    await select(page, ...FIRST)
    let names = await toolbarNames(page)
    if (names.join('|') !== 'Highlight: Quotes|Highlight: Green|Highlight: Vocabulary|Highlight: Pink|Highlight: Questions|Add a highlighter') fail(`the toolbar offers ${names.join(', ')}`)
    await use(toolbar(page).getByRole('button', { name: 'Highlight: Questions' }))
    await pause(1000)
    if ((await highlights())[0]?.colour !== questions.id) fail('highlighting in Questions did not keep it in Questions')
    if ((await drawn(page)).map(mark => mark.fill).join() !== '#b39ddb') fail(`the page shows ${JSON.stringify(await drawn(page))}`)
    pass('the toolbar offers Questions after the built-ins, then Add a highlighter, and highlights in it')

    // Edit a built-in: its highlights are redrawn.
    await select(page, ...SECOND)
    await use(toolbar(page).getByRole('button', { name: 'Highlight: Pink' }))
    await pause(1000)
    await openPrefs(page)
    await use(page.locator('#prefs').getByRole('button', { name: 'Edit Pink' }))
    await pause(400)
    state = await sheetState(page, 'Edit highlighter')
    if (state.name !== 'Pink' || state.checked !== 'Pink') fail(`Edit Pink opens on ${JSON.stringify(state)}`)
    await sheet(page, 'Edit highlighter').getByRole('textbox', { name: 'Name (optional)' }).fill('Rose')
    await use(sheet(page, 'Edit highlighter').getByRole('radio', { name: 'Red' }))
    await use(sheet(page, 'Edit highlighter').getByRole('button', { name: 'Save' }))
    await pause(1000)
    kept = await highlighters()
    if (JSON.stringify(kept[3]) !== JSON.stringify({ id: 'pink', name: 'Rose', colour: '#e57373', builtIn: true, uses: 1 })) fail(`after editing Pink the server keeps ${JSON.stringify(kept[3])}`)
    if (!await page.locator('#prefs').isVisible()) fail('saving the edit closed Preferences')
    await closeAll(page)
    if (!(await drawn(page)).some(mark => mark.colour === 'pink' && mark.fill === '#e57373')) fail(`after the edit the page shows ${JSON.stringify(await drawn(page))}`)
    pass("editing Pink to Rose in red keeps it a built-in, and its highlight is redrawn in red")

    // The arrows move one place; a drag by the handle moves it where it is dropped; the toolbar follows.
    await openPrefs(page)
    await page.locator('#prefs').getByRole('button', { name: 'Move Questions' }).focus()
    await page.keyboard.press('ArrowUp')
    await pause(1000)
    kept = await highlighters()
    if (kept.map(highlighter => highlighter.name).join('|') !== 'Quotes|Green|Vocabulary|Questions|Rose') fail(`after ArrowUp the order is ${kept.map(highlighter => highlighter.name).join(', ')}`)
    await page.locator('#prefs .highlighter-list li').nth(2).scrollIntoViewIfNeeded()
    const handle = await page.locator('#prefs').getByRole('button', { name: 'Move Quotes' }).boundingBox()
    const target = await page.locator('#prefs .highlighter-list li').nth(2).boundingBox()
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(handle.x + handle.width / 2, target.y + target.height * 0.75, { steps: 10 })
    await page.mouse.up()
    await pause(1000)
    kept = await highlighters()
    const order = kept.map(highlighter => highlighter.name).join('|')
    if (order !== 'Green|Vocabulary|Quotes|Questions|Rose') fail(`after dragging Quotes the order is ${order.replaceAll('|', ', ')}`)
    await closeAll(page)
    await select(page, ...THIRD)
    names = await toolbarNames(page)
    if (names.join('|') !== 'Highlight: Green|Highlight: Vocabulary|Highlight: Quotes|Highlight: Questions|Highlight: Rose|Add a highlighter') fail(`after reordering the toolbar offers ${names.join(', ')}`)
    pass(`the arrows and a drag by the handle reorder them (${order.replaceAll('|', ', ')}), and the toolbar follows`)

    // The toolbar's + adds one and highlights the selection in it.
    await use(toolbar(page).getByRole('button', { name: 'Add a highlighter' }))
    await pause(400)
    if (await toolbar(page).isVisible()) fail('the toolbar stayed open under the New highlighter sheet')
    await use(sheet(page, 'New highlighter').getByRole('radio', { name: 'Teal' }))
    await use(sheet(page, 'New highlighter').getByRole('button', { name: 'Add highlighter' }))
    await pause(1200)
    kept = await highlighters()
    const teal = kept.find(highlighter => highlighter.name === 'Teal')
    if (!teal || teal.colour !== '#4db6ac') fail(`a highlighter added from the toolbar with no name is kept as ${JSON.stringify(kept.at(-1))}`)
    const third = (await highlights()).find(highlight => highlight.text === THIRD[1])
    if (third?.colour !== teal.id) fail('the toolbar\'s new highlighter did not highlight the selection')
    pass("the toolbar's + adds a highlighter named after its swatch (Teal) and highlights the selection in it")

    // Delete asks first; Cancel keeps it; Delete moves its highlights to Quotes.
    await openPrefs(page)
    await use(page.locator('#prefs').getByRole('button', { name: 'Delete Questions' }))
    await pause(600)
    const dialog = page.getByRole('alertdialog', { name: 'Delete the Questions highlighter?' })
    if (!await dialog.isVisible()) fail('Delete Questions did not ask first')
    const body = (await dialog.locator('p').innerText()).trim()
    if (body !== '1 highlight uses it. It will become a Quotes highlight, so nothing you marked is lost.') fail(`the confirmation says '${body}'`)
    await use(dialog.getByRole('button', { name: 'Cancel' }))
    await pause(400)
    if ((await highlighters()).length !== 6) fail('Cancel deleted the highlighter')
    await use(page.locator('#prefs').getByRole('button', { name: 'Delete Questions' }))
    await pause(600)
    await use(dialog.getByRole('button', { name: 'Delete' }))
    await pause(1200)
    kept = await highlighters()
    if (kept.some(highlighter => highlighter.name === 'Questions')) fail('Delete kept the highlighter')
    const first = (await highlights()).find(highlight => highlight.text === FIRST[1])
    if (first?.colour !== 'yellow') fail(`its highlight is now ${first?.colour}`)
    await closeAll(page)
    if (!(await drawn(page)).some(mark => mark.colour === 'yellow' && mark.fill === '#ffd54f')) fail(`after deleting, the page shows ${JSON.stringify(await drawn(page))}`)
    pass(`Delete asks '${body}', Cancel keeps it, and Delete makes its highlight a Quotes highlight on the page and the server`)

    // At 8 there is no more Add; another browser sees the same list.
    const full = (await highlighters()).map(({ id, name, colour }) => ({ id, name, colour }))
    while (full.length < 8) full.push({ name: `Extra ${full.length}`, colour: '#a1887f' })
    await putHighlighters(full)
    const other = await browser.newContext(setup.context)
    await other.addInitScript(value => {
        localStorage.setItem('jellyfin_credentials', value)
        localStorage.setItem('oriel-hints', JSON.stringify({ first: true, scroll: true }))
    }, credentials)
    const second = await open(other)
    await openPrefs(second)
    list = await prefsList(second)
    if (list.count !== '8 of 8' || list.add) fail(`with 8 highlighters Preferences shows ${list.count}, Add ${list.add ? 'shown' : 'hidden'}`)
    if (list.rows.map(row => row.name).join('|') !== full.map(highlighter => highlighter.name).join('|')) fail(`another browser lists ${list.rows.map(row => row.name).join(', ')}`)
    await closeAll(second)
    await select(second, ...THIRD)
    names = await toolbarNames(second)
    if (names.includes('Add a highlighter') || names.length !== 8) fail(`with 8 highlighters the toolbar offers ${names.join(', ')}`)
    await other.close()
    pass('another browser lists the same 8 highlighters, and at 8 neither Preferences nor the toolbar offers Add a highlighter')
} catch (error) {
    console.error(`FAIL: ${browserName}: ${error.message}`)
    failed = true
} finally {
    await reset().catch(() => {})
    // WebKit can hang while closing; the result is already known, so stop waiting.
    await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 10_000))])
}
process.exit(failed ? 1 : 0)
