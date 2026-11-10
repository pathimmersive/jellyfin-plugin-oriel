// Checks custom themes in the browser named by ORIEL_BROWSER: webkit at iPhone
// size with touch, or chromium at desktop size with a mouse. With Dark in use,
// Add (the dashed card after the themes) opens New theme (on a phone 47 px
// from the top) with a name, a preview and ten colours starting from Dark's.
// A name and Night Blue's colours, then Save, add the theme after the
// built-ins and choose it: the page, the book's text and the reading footer,
// the controls' background and text, the chosen card's accent and an
// unavailable font button all take its colours, the server keeps it, and they
// stay after a reload. Choosing its card again opens Edit theme; a new Accent
// saved recolours the reader. Delete theme asks 'Delete Night Blue?', saying
// Oriel will switch to Light; Delete removes it from the server and the row and
// brings back Light and Jellyfin's colours. Configured by environment:
// ORIEL_BASE (server URL including any BaseUrl), ORIEL_SERVER_ID,
// ORIEL_USER_ID, ORIEL_TOKEN, ORIEL_ITEM_ID (the test EPUB) and ORIEL_BROWSER.
// Exits non-zero on the first failed check.
import { chromium, devices, webkit } from 'playwright'
import { press as pressAt } from './press.mjs'

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
const use = locator => setup.touch ? locator.tap() : locator.click()

// Night Blue, as the canvas draws it, and the colours the browser reports for it.
const NIGHT_BLUE = {
    Background: '#0f1a2a', Text: '#d7dee8', 'Secondary text': '#9fb0c4', Accent: '#7cc4ff', Selection: '#2e5a85',
    Separator: '#2b4466', Controls: '#14243a', 'Controls text': '#e6edf5', Buttons: '#23395a', Grayed: '#6c7f96',
}
const rgb = hex => `rgb(${[1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16)).join(', ')})`
// Dark's colours as New theme starts from them.
const FROM_DARK = {
    Background: '#101010', Text: '#d6d6d6', 'Secondary text': '#9a9a9a', Accent: '#00a4dc', Selection: '#00506b',
    Separator: '#2e2e2e', Controls: '#202020', 'Controls text': '#dedede', Buttons: '#424242', Grayed: '#6b6b6b',
}
const NAME = 'Night Blue'
const CARD = `${NAME}, a custom theme; open it to edit`

// The server's themes for the user, and clearing them, as the user.
const authorization = `MediaBrowser Client="oriel-e2e", Device="e2e", DeviceId="oriel-e2e-themes", Version="1.0.0", Token="${token}"`
const stored = async () => {
    const response = await fetch(`${base}/Oriel/Themes`, { headers: { Authorization: authorization } })
    if (!response.ok) fail(`GET /Oriel/Themes returned ${response.status}`)
    return response.json()
}
const clear = () => fetch(`${base}/Oriel/Themes`, {
    method: 'PUT',
    headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: '[]',
})

const open = async context => {
    const page = await context.newPage()
    await page.goto(`${base}/Oriel/?id=${itemId}`)
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 })
        .catch(() => fail('the reader did not render the test EPUB'))
    await pause(1500)
    return page
}

const openPrefs = async page => {
    if (!await page.locator('#controls header').isVisible()) {
        if (!await pressAt(page, 0.5, setup.touch)) fail('no frame shows the page to tap')
        await pause(600)
    }
    await use(page.getByRole('button', { name: 'Preferences' }))
    await pause(400)
    const panel = page.locator('#prefs')
    if (!await panel.isVisible()) fail('Preferences did not open')
    return panel
}

const themeRow = panel => panel.getByRole('group', { name: 'Theme' })
const title = async panel => (await panel.locator('.panel-header h2').innerText()).trim()

// The colours of the colour pickers, by name.
const pickers = panel => panel.locator('.theme-sheet input[type="color"]').evaluateAll(inputs =>
    Object.fromEntries(inputs.map(input => [input.getAttribute('aria-label').replace(/ colour$/, ''), input.value])))

// Sets the colour pickers, as the reader choosing each colour would.
const pick = (panel, colours) => panel.locator('.theme-sheet').evaluate((sheet, chosen) => {
    for (const [name, value] of Object.entries(chosen)) {
        const input = sheet.querySelector(`input[aria-label="${name} colour"]`)
        input.value = value
        input.dispatchEvent(new Event('input', { bubbles: true }))
    }
}, colours)

// The colours the reader shows: the book's text and page, the reading footer,
// the controls' header, Preferences and its chosen card's name.
const colours = page => page.evaluate(() => {
    const { doc } = document.querySelector('foliate-view').renderer.getContents()[0]
    const style = element => element ? getComputedStyle(element) : null
    const book = doc.defaultView.getComputedStyle(doc.body)
    const header = style(document.querySelector('#controls header'))
    const prefs = style(document.querySelector('#prefs'))
    return {
        text: book.color,
        page: book.backgroundColor,
        footer: style(document.getElementById('reading-footer')).color,
        header: header.backgroundColor,
        headerText: header.color,
        prefs: prefs.backgroundColor,
        prefsText: prefs.color,
        accent: style(document.querySelector('#prefs .theme[aria-pressed="true"] .name'))?.color ?? null,
    }
})

const expectColours = (shown, theme, what) => {
    const want = {
        text: rgb(theme.Text), page: rgb(theme.Background), footer: rgb(theme['Secondary text']),
        header: rgb(theme.Controls), headerText: rgb(theme['Controls text']),
        prefs: rgb(theme.Controls), prefsText: rgb(theme['Controls text']), accent: rgb(theme.Accent),
    }
    const wrong = Object.entries(want).filter(([key, value]) => shown[key] !== null && shown[key] !== value)
    if (wrong.length) fail(`${what}: ${wrong.map(([key, value]) => `${key} is ${shown[key]}, not ${value}`).join('; ')}`)
}

const browser = await setup.engine.launch()
let failed = false
try {
    await clear()
    const context = await browser.newContext(setup.context)
    await context.addInitScript(value => {
        localStorage.setItem('jellyfin_credentials', value)
        localStorage.setItem('oriel-hints', JSON.stringify({ first: true, scroll: true }))
    }, credentials)
    let page = await open(context)

    // Add follows the themes and opens New theme, starting from the theme in use.
    let panel = await openPrefs(page)
    await use(themeRow(panel).getByRole('button', { name: 'Dark', exact: true }))
    await pause(400)
    const add = themeRow(panel).getByRole('button', { name: 'Add a theme' })
    if (!await add.isVisible()) fail('the theme row has no Add card')
    await use(add)
    await pause(400)
    if (await title(panel) !== 'New theme') fail(`Add opened '${await title(panel)}', not New theme`)
    if (setup.touch) {
        const top = Math.round((await panel.boundingBox()).y)
        if (top !== 47) fail(`New theme opens ${top} px from the top, not 47 px`)
    }
    const start = await pickers(panel)
    if (JSON.stringify(start) !== JSON.stringify(FROM_DARK)) fail(`New theme starts from ${JSON.stringify(start)}, not Dark's colours`)
    if (!await panel.getByRole('img', { name: 'Preview of the theme' }).isVisible()) fail('New theme shows no preview')
    if (!await panel.getByRole('button', { name: 'Save' }).isDisabled()) fail('Save is offered before the theme has a name')
    if (await panel.getByRole('button', { name: 'Delete theme' }).isVisible()) fail('New theme offers Delete theme')
    pass(`Add opens New theme${setup.touch ? ' 47 px from the top' : ''} with a preview and ten colours from Dark's, and Save waits for a name`)

    // A name and Night Blue's colours: the preview follows, and Save adds and chooses it.
    await panel.getByRole('textbox', { name: 'Name' }).fill(NAME)
    await pick(panel, NIGHT_BLUE)
    const preview = await panel.locator('.preview-header').evaluate(header => getComputedStyle(header).backgroundColor)
    if (preview !== rgb(NIGHT_BLUE.Controls)) fail(`the preview's header is ${preview}, not the Controls colour`)
    await use(panel.getByRole('button', { name: 'Save' }))
    await pause(1000)
    if (await title(panel) !== 'Preferences') fail(`after Save the panel shows '${await title(panel)}', not Preferences`)
    const card = themeRow(panel).getByRole('button', { name: CARD })
    if (await card.getAttribute('aria-pressed') !== 'true') fail(`after Save '${NAME}' is not the chosen theme`)
    const names = (await themeRow(panel).locator('.name').allInnerTexts()).map(text => text.trim())
    if (names.join(',') !== `Light,Sepia,Dark,${NAME},Add`) fail(`the theme row reads ${names.join(', ')}`)
    const kept = await stored()
    if (kept.length !== 1 || kept[0].name !== NAME || kept[0].controls !== NIGHT_BLUE.Controls || kept[0].grayed !== NIGHT_BLUE.Grayed) fail(`the server keeps ${JSON.stringify(kept)}`)
    expectColours(await colours(page), NIGHT_BLUE, `with ${NAME} chosen`)
    pass(`Save adds '${NAME}' after the built-ins, chooses it and keeps it on the server; the page, text, reading footer, controls and accent take its colours`)

    // An unavailable item takes Grayed: the font buttons under the book's own layout.
    const bookLayout = panel.getByRole('checkbox', { name: "Use the book's layout and fonts" })
    await use(bookLayout)
    await pause(400)
    const grayed = await panel.getByRole('group', { name: 'Font' }).getByRole('button').first().evaluate(button =>
        ({ disabled: button.disabled, color: getComputedStyle(button).color, opacity: getComputedStyle(button).opacity }))
    if (!grayed.disabled || grayed.color !== rgb(NIGHT_BLUE.Grayed) || grayed.opacity !== '1') fail(`an unavailable font button is ${JSON.stringify(grayed)}, not Grayed`)
    await use(bookLayout)
    await pause(400)
    pass('an unavailable font button shows in Grayed')

    // After a reload the theme is still chosen and still colours the reader.
    await page.reload()
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 }).catch(() => fail('the reader did not render after a reload'))
    await pause(1500)
    panel = await openPrefs(page)
    if (await themeRow(panel).getByRole('button', { name: CARD }).getAttribute('aria-pressed') !== 'true') fail(`after a reload '${NAME}' is not chosen`)
    expectColours(await colours(page), NIGHT_BLUE, 'after a reload')
    pass(`after a reload '${NAME}' is still chosen and colours the reader`)

    // Its card, chosen, opens Edit theme; a new Accent saved recolours the reader.
    await use(themeRow(panel).getByRole('button', { name: CARD }))
    await pause(400)
    if (await title(panel) !== 'Edit theme') fail(`choosing the chosen custom theme opened '${await title(panel)}', not Edit theme`)
    if (await panel.getByRole('textbox', { name: 'Name' }).inputValue() !== NAME) fail('Edit theme does not show the theme\'s name')
    if (JSON.stringify(await pickers(panel)) !== JSON.stringify(NIGHT_BLUE)) fail(`Edit theme shows ${JSON.stringify(await pickers(panel))}`)
    const orange = { ...NIGHT_BLUE, Accent: '#ff9800' }
    await pick(panel, { Accent: orange.Accent })
    await use(panel.getByRole('button', { name: 'Save' }))
    await pause(1000)
    expectColours(await colours(page), orange, 'after Edit theme saved a new Accent')
    if ((await stored())[0]?.accent !== orange.Accent) fail('the server did not keep the new Accent')
    pass('choosing the chosen custom theme opens Edit theme with its colours, and a new Accent saved recolours the reader')

    // Delete theme asks first, then switches to Light and Jellyfin's colours.
    await use(themeRow(panel).getByRole('button', { name: CARD }))
    await pause(400)
    await use(panel.getByRole('button', { name: 'Delete theme' }))
    await pause(400)
    const dialog = page.getByRole('alertdialog')
    const words = [await dialog.locator('h2').innerText(), await dialog.locator('p').innerText()].map(text => text.trim())
    if (words[0] !== `Delete ${NAME}?` || words[1] !== 'You are reading with this theme now, so Oriel will switch to Light.') fail(`the dialog reads ${JSON.stringify(words)}`)
    await use(dialog.getByRole('button', { name: 'Delete' }))
    await pause(1000)
    if (await dialog.isVisible()) fail('the dialog stays open after Delete')
    if ((await stored()).length) fail('the server still keeps the deleted theme')
    if (await themeRow(panel).getByRole('button', { name: CARD }).count()) fail('the deleted theme is still in the row')
    if (await themeRow(panel).getByRole('button', { name: 'Light', exact: true }).getAttribute('aria-pressed') !== 'true') fail('after deleting the theme in use, Light is not chosen')
    const light = await colours(page)
    if (light.page !== 'rgb(255, 255, 255)' || light.text !== 'rgb(27, 27, 27)' || light.prefs !== 'rgb(32, 32, 32)' || light.accent !== 'rgb(0, 164, 220)') fail(`after Delete the reader shows ${JSON.stringify(light)}`)
    pass(`Delete theme asks 'Delete ${NAME}?' saying Oriel will switch to Light, and Delete removes it and brings back Light and Jellyfin's colours`)
    await page.close()
} catch (error) {
    console.error(`FAIL: ${browserName}: ${error.message}`)
    failed = true
} finally {
    await clear().catch(() => {})
    await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 10_000))])
}
process.exit(failed ? 1 : 0)
