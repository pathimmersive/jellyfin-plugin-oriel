// Checks highlights in the browser named by ORIEL_BROWSER: webkit at iPhone size
// with touch, or chromium at desktop size with a mouse. On the test EPUB,
// selecting text shows the Selected text toolbar beside it with the four
// highlighters; one highlights the text on the page and the server keeps it.
// Tapping or clicking a highlight shows the toolbar with its highlighter pressed
// and Remove, without turning the page or showing the controls; another
// highlighter recolours it and Remove removes it; a tap elsewhere and Escape
// close it. The Contents panel's Highlights tab lists highlights in book order
// marked in their colours, filters them by colour, goes to one from another
// chapter and saves the place, deletes one, and says when there are none.
// Highlights made in one browser show on the page and in the list in another.
// The toolbar's Note opens the Note sheet: Cancel keeps nothing, Save makes a
// highlight with its note; a tapped highlight with a note offers Edit note, an
// edit is kept and shows in the list and in another browser, and an emptied
// note is removed. A comic offers no highlighting. Nothing is requested from another host.
// Configured by environment: ORIEL_BASE (server URL including any BaseUrl),
// ORIEL_SERVER_ID, ORIEL_USER_ID, ORIEL_TOKEN, ORIEL_ITEM_ID (the test EPUB),
// ORIEL_CBZ_ID and ORIEL_BROWSER. Exits non-zero on the first failed check.
import { chromium, devices, webkit } from 'playwright'
import { press, pressPoint } from './press.mjs'
import { pause, until, watchMove } from './wait.mjs'

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
const comicId = env('ORIEL_CBZ_ID')
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

// Presses a button or link as this screen's reader would: a tap on a touch screen, else a click.
const use = locator => setup.touch ? locator.tap() : locator.click()

// The server's highlights for a book, and removing them, as the user.
const authorization = `MediaBrowser Client="oriel-e2e", Device="e2e", DeviceId="oriel-e2e-highlights", Version="1.0.0", Token="${token}"`
const stored = async id => {
    const response = await fetch(`${base}/Oriel/Highlights/${id}`, { headers: { Authorization: authorization } })
    if (!response.ok) fail(`GET /Oriel/Highlights returned ${response.status}`)
    return response.json()
}
const clear = async id => {
    for (const highlight of await stored(id)) {
        await fetch(`${base}/Oriel/Highlights/${id}/${highlight.id}`, { method: 'DELETE', headers: { Authorization: authorization } })
    }
    // The four built-in highlighters, as a reader who has changed nothing has them.
    await fetch(`${base}/Oriel/Highlighters`, {
        method: 'PUT',
        headers: { Authorization: authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify([['yellow', 'Quotes', '#ffd54f'], ['green', 'Green', '#81c784'], ['blue', 'Vocabulary', '#64b5f6'], ['pink', 'Pink', '#f06292']].map(([id, name, colour]) => ({ id, name, colour }))),
    })
}

const open = async (context, id) => {
    const page = await context.newPage()
    await page.goto(`${base}/Oriel/?id=${id}`)
    await page.waitForSelector('body[data-state="rendered"]', { timeout: 30_000 })
        .catch(() => fail(`the reader did not render ${id}`))
    await until(async () => (await page.locator('#reading-footer .progress').innerText()).trim(), `the reader rendered ${id} but its footer shows no progress`)
    return page
}

const showControls = async page => {
    if (await page.locator('#controls header').isVisible()) return
    if (!await press(page, 0.5, setup.touch)) fail('no frame shows the page to tap')
    await until(() => page.locator('#controls header').isVisible(), 'a tap in the middle of the page did not show the controls')
}

// Closes what Escape closes (the toolbar, a panel) and waits until `shown` is gone.
const escape = async (page, shown, what) => {
    await page.keyboard.press('Escape')
    await until(async () => !await shown.isVisible(), `Escape left ${what} open`)
}

// Holds until `ms` have passed since `since`: the window in which a press must do nothing else.
const windowAfter = (since, ms) => pause(Math.max(0, ms - (Date.now() - since)))

const section = page => page.evaluate(() => document.querySelector('foliate-view').renderer.getContents()[0]?.index)

// Goes to a chapter from Contents.
// Waits for the reading footer to show page / total; gives the page shown and the total.
const counted = async (page, timeout = 60_000) => {
    const progress = async () => (await page.locator('#reading-footer .progress').innerText()).trim()
    const match = await until(async () => /^(\d+)\s*\/\s*(\d+)$/.exec(await progress()),
        async () => `the footer still shows '${await progress()}' after ${timeout / 1000} s, not page / total`, timeout)
    return { page: Number(match[1]), total: Number(match[2]) }
}

// Opens Preferences, runs `change` on it and closes it.
const preferences = async (page, change) => {
    await showControls(page)
    await use(page.getByRole('button', { name: 'Preferences' }))
    const panel = page.locator('#prefs')
    await until(() => panel.isVisible(), 'Preferences did not open')
    await change(panel)
    await escape(page, panel, 'Preferences')
}

// Goes to a chapter from Contents, once the move there has finished.
const goToChapter = async (page, name) => {
    await showControls(page)
    await use(page.getByRole('button', { name: 'Contents' }))
    await until(() => page.locator('#contents').isVisible(), 'Contents did not open')
    await use(page.locator('#contents').getByRole('tab', { name: 'Contents' }))
    const moved = await watchMove(page, `Contents did not move to ${name}`)
    await use(page.locator('#contents').getByRole('link', { name: new RegExp(`^${name}`) }))
    await moved()
    await until(async () => !await page.locator('#contents').isVisible(), `going to ${name} left Contents open`)
}

// The boxes on screen of `words` in the paragraph starting `paragraph`, in
// the section shown: each line's, and the whole range's.
const place = (page, paragraph, words) => page.evaluate(({ paragraph, words }) => {
    const { doc } = document.querySelector('foliate-view').renderer.getContents()[0]
    const frame = doc.defaultView.frameElement.getBoundingClientRect()
    const p = [...doc.querySelectorAll('p')].find(each => each.textContent.startsWith(paragraph))
    const text = p?.firstChild
    const at = text?.textContent.indexOf(words) ?? -1
    if (at < 0) return null
    const range = doc.createRange()
    range.setStart(text, at)
    range.setEnd(text, at + words.length)
    const shift = ({ left, top, right, bottom }) => ({ left: left + frame.left, top: top + frame.top, right: right + frame.left, bottom: bottom + frame.top })
    return { lines: [...range.getClientRects()].map(shift), box: shift(range.getBoundingClientRect()), at }
}, { paragraph, words })

// Selects `words` in the paragraph starting `paragraph`: with the mouse, a
// drag across them; on a touch screen, as a long press and handle drag leave
// it, set in the frame (Playwright cannot long-press).
const select = async (page, paragraph, words) => {
    const where = await place(page, paragraph, words)
    if (!where) fail(`'${words}' is not on the page`)
    if (setup.touch) {
        await page.evaluate(({ paragraph, at, length }) => {
            const { doc } = document.querySelector('foliate-view').renderer.getContents()[0]
            const text = [...doc.querySelectorAll('p')].find(each => each.textContent.startsWith(paragraph)).firstChild
            const range = doc.createRange()
            range.setStart(text, at)
            range.setEnd(text, at + length)
            doc.getSelection().removeAllRanges()
            doc.getSelection().addRange(range)
        }, { paragraph, at: where.at, length: words.length })
    } else {
        const [first] = where.lines
        const last = where.lines.at(-1)
        // Watch for the mouse up arriving in the section's frame: until it has, a move to the toolbar would still drag the selection.
        await page.evaluate(() => {
            const { doc } = document.querySelector('foliate-view').renderer.getContents()[0]
            window.orielMouseUp = false
            doc.addEventListener('mouseup', () => { window.orielMouseUp = true }, { once: true })
        })
        await page.mouse.move(first.left + 0.5, (first.top + first.bottom) / 2)
        await page.mouse.down()
        await page.mouse.move(last.right - 0.5, (last.top + last.bottom) / 2, { steps: 8 })
        // The frame takes a drag's moves a moment after they are sent: release only once it has
        // selected the words, or the reader settles on part of them.
        await until(async () => await selectedText(page) === words, async () => `dragging across '${words}' selected '${await selectedText(page)}'`)
        await page.mouse.up()
        await until(() => page.evaluate(() => window.orielMouseUp), 'the section never had the mouse up that ends the drag')
    }
    await until(async () => await selectedText(page) === words, async () => `selecting '${words}' selected '${await selectedText(page)}'`)
    await until(() => toolbar(page).isVisible(), 'selecting text shows no Selected text toolbar')
    return where
}

const selectedText = page => page.evaluate(() =>
    document.querySelector('foliate-view').renderer.getContents()[0].doc.getSelection().toString())

// Taps or clicks the middle of the first line of `words`, a highlight, and waits
// for its toolbar; gives the time of the tap.
const tapWords = async (page, paragraph, words) => {
    const where = await place(page, paragraph, words)
    if (!where) fail(`'${words}' is not on the page`)
    const [line] = where.lines
    const tapped = Date.now()
    if (!await pressPoint(page, (line.left + line.right) / 2, (line.top + line.bottom) / 2, setup.touch)) fail('no frame shows the page to tap')
    await until(() => toolbar(page).isVisible(), 'tapping a highlight shows no toolbar')
    return tapped
}

// The highlights drawn on the page: each one's colour, and whether it is ringed.
const drawn = page => page.evaluate(() => document.querySelector('foliate-view').renderer.getContents()
    .flatMap(({ overlayer }) => [...overlayer?.element.querySelectorAll('g[data-colour]') ?? []])
    .map(group => ({ colour: group.getAttribute('data-colour'), ringed: group.hasAttribute('data-ringed') })))

const toolbar = page => page.getByRole('toolbar', { name: 'Selected text' })
const highlighterNames = ['Highlight: Quotes', 'Highlight: Green', 'Highlight: Vocabulary', 'Highlight: Pink']

// The toolbar's highlighters and which is pressed, and whether Remove shows.
const toolbarState = async page => {
    const bar = toolbar(page)
    const buttons = await bar.getByRole('group', { name: 'Highlighters' }).getByRole('button').evaluateAll(items =>
        items.filter(item => item.getAttribute('aria-label').startsWith('Highlight: ')).map(item => ({ name: item.getAttribute('aria-label'), pressed: item.getAttribute('aria-pressed') })))
    return { buttons, remove: await bar.getByRole('button', { name: 'Remove' }).isVisible() }
}

const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

// Opens Contents on its Highlights tab; returns the panel.
const openHighlights = async page => {
    await showControls(page)
    await use(page.getByRole('button', { name: 'Contents' }))
    const panel = page.locator('#contents')
    await until(() => panel.isVisible(), 'Contents did not open')
    const tabs = (await panel.getByRole('tab').allInnerTexts()).map(text => text.trim())
    if (tabs.join('|') !== 'Contents|Bookmarks|Highlights') fail(`the Contents panel's tabs are ${tabs.join(', ')}`)
    await use(panel.getByRole('tab', { name: 'Highlights' }))
    await until(async () => await panel.getByRole('tab', { name: 'Highlights' }).getAttribute('aria-selected') === 'true', 'the Highlights tab is not selected')
    return panel
}

// The rows of the Highlights tab: the text marked, its colour and fill, and the where line.
const rows = panel => panel.locator('.highlights li').evaluateAll(items => items.map(item => {
    const mark = item.querySelector('mark')
    return {
        text: mark?.textContent?.trim() ?? '',
        colour: mark?.dataset.colour ?? '',
        fill: mark ? getComputedStyle(mark).backgroundColor : '',
        where: item.querySelector('.where')?.textContent?.trim() ?? '',
    }
}))

const chips = panel => panel.getByRole('group', { name: 'Show highlights of one colour' }).getByRole('button').evaluateAll(items =>
    items.map(item => `${item.textContent.trim()}${item.getAttribute('aria-pressed') === 'true' ? '*' : ''}`))

// The Note sheet, and what it shows: the text and its fill, the highlighter pressed, and the note.
const noteSheet = page => page.getByRole('region', { name: 'Note' })
const noteState = async page => ({
    quote: (await noteSheet(page).locator('.quote mark').innerText()).trim(),
    fill: await noteSheet(page).locator('.quote mark').evaluate(mark => getComputedStyle(mark).backgroundColor),
    pressed: await noteSheet(page).getByRole('group', { name: 'Highlighters' }).getByRole('button', { pressed: true }).getAttribute('aria-label'),
    note: await noteSheet(page).getByRole('textbox', { name: 'Note' }).inputValue(),
})
const noteButton = page => toolbar(page).getByRole('button', { name: /^(Note|Edit note)$/ })

const FIRST = ['Paragraph 1 holds', 'plain filler text']
const SECOND = ['Paragraph 2 holds', 'every chapter']
const THIRD = ['Paragraph 3 holds', 'about the same length']

const browser = await setup.engine.launch()
let failed = false
try {
    await clear(itemId)
    const context = await browser.newContext(setup.context)
    await context.addInitScript(value => {
        localStorage.setItem('jellyfin_credentials', value)
        // The reading gestures hint was seen on this device before.
        localStorage.setItem('oriel-hints', JSON.stringify({ first: true, scroll: true }))
    }, credentials)
    const elsewhere = []
    context.on('request', request => {
        const url = request.url()
        if (/^https?:/.test(url) && new URL(url).origin !== origin) elsewhere.push(url)
    })

    // Start in Chapter One, whose filler paragraphs are on its first page.
    const page = await open(context, itemId)
    await goToChapter(page, 'Chapter One')
    if (await section(page) !== 0) fail('Contents did not go to Chapter One')

    // Selecting text shows the toolbar beside it with the four highlighters.
    const selected = await select(page, ...FIRST)
    if (!await toolbar(page).isVisible()) fail('selecting text shows no Selected text toolbar')
    let shown = await toolbarState(page)
    if (shown.buttons.map(button => button.name).join('|') !== highlighterNames.join('|')) fail(`the toolbar's highlighters are ${JSON.stringify(shown.buttons)}`)
    if (shown.buttons.some(button => button.pressed !== null)) fail('for a selection, a highlighter shows pressed')
    if (shown.remove) fail('for a selection, the toolbar shows Remove')
    const bar = await toolbar(page).boundingBox()
    const barBox = { left: bar.x, top: bar.y, right: bar.x + bar.width, bottom: bar.y + bar.height }
    if (overlaps(barBox, selected.box)) fail(`the toolbar ${JSON.stringify(barBox)} covers the selection ${JSON.stringify(selected.box)}`)
    for (const box of await toolbar(page).getByRole('button').evaluateAll(items => items.filter(item => item.offsetParent).map(item => item.getBoundingClientRect()))) {
        if (box.width < 44 || box.height < 44) fail('a toolbar button is under 44 px')
    }
    pass(`selecting '${await selectedText(page)}' shows the Selected text toolbar beside it with ${highlighterNames.length} highlighters`)

    // A highlighter highlights it, clears the selection and closes the toolbar.
    await use(toolbar(page).getByRole('button', { name: 'Highlight: Vocabulary' }))
    await until(async () => !await toolbar(page).isVisible(), 'choosing a highlighter left the toolbar open')
    await until(async () => !await selectedText(page), 'choosing a highlighter left the text selected')
    let kept = await until(async () => { const all = await stored(itemId); return all.length && all }, 'the server keeps no highlight after choosing a highlighter')
    if (kept.length !== 1 || kept[0].colour !== 'blue' || kept[0].text !== FIRST[1]) fail(`the server keeps ${JSON.stringify(kept)}`)
    let marks = await until(async () => { const all = await drawn(page); return all.length && all }, 'the highlight is not drawn on the page')
    if (marks.length !== 1 || marks[0].colour !== 'blue' || marks[0].ringed) fail(`the page shows ${JSON.stringify(marks)}`)
    pass(`'Highlight: Vocabulary' marks '${kept[0].text}' on the page and the server keeps it in ${kept[0].colour}`)

    // Tapping it shows the toolbar for it, without turning the page or showing the controls.
    const tapped = await tapWords(page, ...FIRST)
    shown = await toolbarState(page)
    const pressed = shown.buttons.filter(button => button.pressed === 'true').map(button => button.name)
    if (pressed.join() !== 'Highlight: Vocabulary') fail(`for the highlight, the pressed highlighters are ${pressed.join(', ') || 'none'}`)
    if (!shown.remove) fail('for a highlight, the toolbar shows no Remove')
    // The tap must do nothing else: a turn or the controls would show within this time.
    await windowAfter(tapped, 600)
    if (await page.locator('#controls header').isVisible()) fail('tapping a highlight showed the controls')
    if (await section(page) !== 0) fail('tapping a highlight turned the page')
    marks = await drawn(page)
    if (!marks[0]?.ringed) fail('the highlight tapped is not ringed')
    pass('tapping a highlight shows the toolbar with Vocabulary pressed and Remove, rings it, and neither turns the page nor shows the controls')

    // Another highlighter recolours it.
    await use(toolbar(page).getByRole('button', { name: 'Highlight: Pink' }))
    await until(async () => (await stored(itemId))[0]?.colour === 'pink' && (await drawn(page))[0]?.colour === 'pink', 'another highlighter did not recolour the highlight')
    kept = await stored(itemId)
    marks = await drawn(page)
    if (kept.length !== 1 || kept[0].colour !== 'pink' || marks.length !== 1 || marks[0].colour !== 'pink' || marks[0].ringed) fail(`after recolouring, the server keeps ${JSON.stringify(kept)} and the page shows ${JSON.stringify(marks)}`)
    pass('another highlighter recolours the highlight, on the page and on the server')

    // A tap elsewhere and Escape close the toolbar.
    await tapWords(page, ...FIRST)
    const elsewhereTapped = Date.now()
    if (!await press(page, 0.5, setup.touch, 0.92)) fail('no frame shows the page to tap')
    await until(async () => !await toolbar(page).isVisible(), 'a tap elsewhere left the toolbar open')
    // The tap must do nothing else: the controls would show within this time.
    await windowAfter(elsewhereTapped, 600)
    if (await page.locator('#controls header').isVisible()) fail('the tap that closed the toolbar also showed the controls')
    await tapWords(page, ...FIRST)
    await escape(page, toolbar(page), 'the toolbar')
    await until(async () => !(await drawn(page)).some(mark => mark.ringed), 'the highlight stays ringed once the toolbar closed')
    pass('a tap elsewhere and Escape close the toolbar, and the tap does nothing else')

    // A second highlight, in Quotes.
    await select(page, ...SECOND)
    await use(toolbar(page).getByRole('button', { name: 'Highlight: Quotes' }))
    await until(async () => (await stored(itemId)).length === 2 && (await drawn(page)).length === 2, 'a second highlight was not kept and drawn')

    // The Highlights tab lists both in book order, marked in their colours.
    const footerPercent = (await page.locator('#reading-footer .progress').innerText()).trim()
    let panel = await openHighlights(page)
    let listed = await rows(panel)
    const expected = [
        { text: FIRST[1], colour: 'pink', fill: 'rgba(240, 98, 146, 0.38)', where: `Chapter One · ${footerPercent}` },
        { text: SECOND[1], colour: 'yellow', fill: 'rgba(255, 213, 79, 0.5)', where: `Chapter One · ${footerPercent}` },
    ]
    if (JSON.stringify(listed) !== JSON.stringify(expected)) fail(`the Highlights tab lists ${JSON.stringify(listed)}`)
    if ((await chips(panel)).join('|') !== 'All*|Quotes|Green|Vocabulary|Pink') fail(`the colour chips are ${(await chips(panel)).join(', ')}`)
    pass(`the Highlights tab lists both in book order, marked in pink and yellow, at '${listed[0].where}'`)

    // The chips filter by colour.
    await use(panel.getByRole('button', { name: 'Pink' }))
    await until(async () => (await chips(panel))[4] === 'Pink*', 'the Pink chip does not show chosen')
    listed = await until(async () => { const now = await rows(panel); return now.length === 1 && now }, async () => `with Pink chosen the tab lists ${JSON.stringify(await rows(panel))}`)
    if (listed.length !== 1 || listed[0].colour !== 'pink' || (await chips(panel))[4] !== 'Pink*') fail(`with Pink chosen the tab lists ${JSON.stringify(listed)}`)
    await use(panel.getByRole('button', { name: 'Green' }))
    const noneShown = panel.locator('.highlights .none')
    await until(async () => await noneShown.count() && await noneShown.isVisible(), 'with Green chosen the tab says nothing')
    const none = (await noneShown.innerText()).trim()
    if (none !== 'No highlights in this colour.' || (await rows(panel)).length) fail(`with Green chosen the tab shows '${none}'`)
    await use(panel.getByRole('button', { name: 'All' }))
    await until(async () => (await rows(panel)).length === 2, 'All does not list every highlight again')
    pass(`the chips filter by colour, and a colour with none says '${none}'`)

    // From Chapter Three, choosing a highlight goes back to it and saves the place.
    await escape(page, panel, 'Contents')
    // Chapter Three is saved first, so going back to the highlight is a change to save. A save
    // of Chapter One still waiting out its delay does not count: it would leave Chapter Three
    // unsaved, and going back to Chapter One then rightly saves nothing.
    const chapterOne = `${(await stored(itemId))[0].cfi.split('!')[0]}!`
    const awayFirst = page.waitForRequest(request => request.method() === 'PUT' && request.url().includes(`/Oriel/Positions/${itemId}`)
        && !String(request.postDataJSON()?.cfi).startsWith(chapterOne), { timeout: 15_000 }).catch(() => null)
    await goToChapter(page, 'Chapter Three')
    if (await section(page) !== 2) fail('Contents did not go to Chapter Three')
    if (!await awayFirst) fail('going to Chapter Three was not saved')
    const saved = page.waitForRequest(request => request.method() === 'PUT' && request.url().includes(`/Oriel/Positions/${itemId}`), { timeout: 15_000 }).catch(() => null)
    panel = await openHighlights(page)
    const backToIt = await watchMove(page, 'choosing the highlight did not move the page')
    await use(panel.locator('.highlights li a').first())
    await backToIt()
    await until(async () => !await panel.isVisible(), 'choosing a highlight left the panel open')
    if (await section(page) !== 0) fail('choosing the highlight did not go back to Chapter One')
    await until(async () => (await drawn(page)).length === 2, 'back in Chapter One, the highlights are not drawn')
    if (!await saved) fail('going to the highlight was not saved to /Oriel/Positions')
    pass('from Chapter Three, choosing a highlight goes back to it, closes the panel, draws it and saves the place')

    // Another browser shows them on the page and in the list.
    const other = await browser.newContext(setup.context)
    await other.addInitScript(value => {
        localStorage.setItem('jellyfin_credentials', value)
        localStorage.setItem('oriel-hints', JSON.stringify({ first: true, scroll: true }))
    }, credentials)
    const second = await open(other, itemId)
    await until(async () => (marks = await drawn(second)).map(mark => mark.colour).sort().join() === 'pink,yellow', () => `another browser draws ${JSON.stringify(marks)}`)
    if ((await rows(await openHighlights(second))).length !== 2) fail('another browser does not list both highlights')
    await other.close()
    pass('another browser draws both highlights on the page and lists them')

    // Remove on the toolbar removes one; Delete this highlight the other, leaving the empty state.
    await tapWords(page, ...FIRST)
    await use(toolbar(page).getByRole('button', { name: 'Remove' }))
    await until(async () => (await stored(itemId)).length === 1 && (await drawn(page)).length === 1, 'Remove did not remove the highlight from the server and the page')
    kept = await stored(itemId)
    marks = await drawn(page)
    if (kept.length !== 1 || kept[0].colour !== 'yellow' || marks.length !== 1) fail(`after Remove the server keeps ${JSON.stringify(kept)} and the page shows ${JSON.stringify(marks)}`)
    panel = await openHighlights(page)
    await use(panel.getByRole('button', { name: 'Delete this highlight' }))
    const emptyShown = panel.locator('.highlights .empty')
    await until(async () => await emptyShown.count() && await emptyShown.isVisible(), 'Delete this highlight did not leave the empty state')
    const empty = (await emptyShown.innerText()).replace(/\s+/g, ' ').trim()
    if (empty !== 'No highlights in this book yet. Select text to highlight it or add a note.') fail(`with no highlights the tab shows '${empty}'`)
    await until(async () => !(await stored(itemId)).length && !(await drawn(page)).length, 'the deleted highlight is still kept or drawn')
    pass(`Remove and Delete this highlight remove them from the page and the server, leaving '${empty}'`)
    await escape(page, panel, 'Contents')

    // Note on the toolbar opens the Note sheet for the selection; Cancel keeps nothing.
    await select(page, ...THIRD)
    if ((await noteButton(page).innerText()).trim() !== 'Note') fail(`for a selection the toolbar's note button reads '${(await noteButton(page).innerText()).trim()}'`)
    await use(noteButton(page))
    await until(() => noteSheet(page).isVisible(), 'Note did not open the Note sheet')
    await until(async () => !await toolbar(page).isVisible(), 'the toolbar stayed open under the Note sheet')
    let sheet = await noteState(page)
    if (JSON.stringify(sheet) !== JSON.stringify({ quote: THIRD[1], fill: 'rgba(255, 213, 79, 0.5)', pressed: 'Highlight: Quotes', note: '' })) fail(`the Note sheet for a selection shows ${JSON.stringify(sheet)}`)
    // Cancel must send nothing: a highlight added while it closes the sheet would be kept.
    const added = []
    const watchAdds = request => { if (request.method() !== 'GET' && request.url().includes('/Oriel/Highlights/')) added.push(`${request.method()} ${request.url()}`) }
    page.on('request', watchAdds)
    await use(noteSheet(page).getByRole('button', { name: 'Cancel' }))
    await until(async () => !await noteSheet(page).isVisible(), 'Cancel left the Note sheet open')
    page.off('request', watchAdds)
    if (added.length || (await stored(itemId)).length) fail(`Cancel kept a highlight ${added.join(', ')}`)
    pass(`Note opens the Note sheet with '${sheet.quote}' in Quotes and an empty note, and Cancel keeps nothing`)

    // Save makes the highlight, in the highlighter chosen on the sheet, with its note.
    await select(page, ...THIRD)
    await use(noteButton(page))
    await until(() => noteSheet(page).isVisible(), 'Note did not open the Note sheet again')
    await use(noteSheet(page).getByRole('button', { name: 'Highlight: Green' }))
    await until(async () => (await noteState(page)).pressed === 'Highlight: Green', 'choosing Green on the sheet does not show it pressed')
    sheet = await noteState(page)
    if (sheet.pressed !== 'Highlight: Green' || sheet.fill !== 'rgba(129, 199, 132, 0.45)') fail(`choosing Green on the sheet shows ${JSON.stringify(sheet)}`)
    await noteSheet(page).getByRole('textbox', { name: 'Note' }).fill('Every chapter runs the same.')
    await use(noteSheet(page).getByRole('button', { name: 'Save' }))
    await until(async () => !await noteSheet(page).isVisible(), 'Save left the Note sheet open')
    kept = await until(async () => { const all = await stored(itemId); return all.length && all }, 'after Save the server keeps no highlight')
    if (kept.length !== 1 || kept[0].colour !== 'green' || kept[0].text !== THIRD[1] || kept[0].note !== 'Every chapter runs the same.') fail(`after Save the server keeps ${JSON.stringify(kept)}`)
    await until(async () => (await drawn(page)).map(mark => mark.colour).join() === 'green', 'the highlight saved with a note is not drawn in green')
    pass(`Save highlights '${kept[0].text}' in green with the note '${kept[0].note}'`)

    // The highlight tapped offers Edit note, with its note; an edit is kept.
    await tapWords(page, ...THIRD)
    if ((await noteButton(page).innerText()).trim() !== 'Edit note') fail('a highlight with a note does not offer Edit note')
    await use(noteButton(page))
    await until(() => noteSheet(page).isVisible(), 'Edit note did not open the Note sheet')
    sheet = await noteState(page)
    if (sheet.pressed !== 'Highlight: Green' || sheet.note !== 'Every chapter runs the same.' || sheet.quote !== THIRD[1]) fail(`Edit note shows ${JSON.stringify(sheet)}`)
    await noteSheet(page).getByRole('textbox', { name: 'Note' }).fill('Every chapter runs about the same.')
    await use(noteSheet(page).getByRole('button', { name: 'Save' }))
    await until(async () => (kept = await stored(itemId))[0]?.note === 'Every chapter runs about the same.', () => `after the edit the server keeps ${JSON.stringify(kept)}`)
    await until(async () => !await noteSheet(page).isVisible(), 'Save left the Note sheet open')
    if (kept.length !== 1 || kept[0].note !== 'Every chapter runs about the same.' || kept[0].colour !== 'green') fail(`after the edit the server keeps ${JSON.stringify(kept)}`)
    pass('Edit note on a tapped highlight shows its note and highlighter, and Save keeps the edit')

    // The Highlights tab shows the note under its highlight.
    panel = await openHighlights(page)
    const noted = await panel.locator('.highlights li .note').allInnerTexts()
    if (noted.map(text => text.trim()).join('|') !== 'Every chapter runs about the same.') fail(`the Highlights tab shows the notes ${JSON.stringify(noted)}`)
    await escape(page, panel, 'Contents')
    pass('the Highlights tab shows the note under its highlight')

    // Another browser shows the note, in the list and on the highlight tapped.
    const third = await browser.newContext(setup.context)
    await third.addInitScript(value => {
        localStorage.setItem('jellyfin_credentials', value)
        localStorage.setItem('oriel-hints', JSON.stringify({ first: true, scroll: true }))
    }, credentials)
    const elsewherePage = await open(third, itemId)
    const theirPanel = await openHighlights(elsewherePage)
    let theirNotes = []
    await until(async () => (theirNotes = await theirPanel.locator('.highlights li .note').allInnerTexts()).map(text => text.trim()).join('|') === 'Every chapter runs about the same.',
        () => `another browser lists the notes ${JSON.stringify(theirNotes)}`)
    await escape(elsewherePage, theirPanel, 'Contents')
    await tapWords(elsewherePage, ...THIRD)
    if ((await noteButton(elsewherePage).innerText()).trim() !== 'Edit note') fail('in another browser the highlight does not offer Edit note')
    await third.close()
    pass('another browser lists the note and offers Edit note on its highlight')

    // An emptied note is removed, and the highlight stays.
    await tapWords(page, ...THIRD)
    await use(noteButton(page))
    await until(() => noteSheet(page).isVisible(), 'Edit note did not open the Note sheet')
    await noteSheet(page).getByRole('textbox', { name: 'Note' }).fill('')
    await use(noteSheet(page).getByRole('button', { name: 'Save' }))
    await until(async () => (kept = await stored(itemId))[0]?.note === '', () => `after emptying the note the server keeps ${JSON.stringify(kept)}`)
    await until(async () => !await noteSheet(page).isVisible(), 'Save left the Note sheet open')
    if (kept.length !== 1 || kept[0].note !== '' || kept[0].colour !== 'green') fail(`after emptying the note the server keeps ${JSON.stringify(kept)}`)
    await tapWords(page, ...THIRD)
    if ((await noteButton(page).innerText()).trim() !== 'Note') fail('with its note emptied, the highlight still offers Edit note')
    await escape(page, toolbar(page), 'the toolbar')
    pass('saving an empty note removes the note and keeps the highlight')

    // With progress in Pages, a highlight shows the page its start is on, one
    // of the pages on screen once the reader goes to it.
    await preferences(page, async panel => {
        const pages = panel.getByRole('radio', { name: 'Pages', exact: true })
        await use(pages)
        await until(() => pages.isChecked(), 'Pages is not chosen after a press')
    })
    await counted(page)
    panel = await openHighlights(page)
    const goneTo = await watchMove(page, 'choosing the highlight with Pages did not move the page')
    await use(panel.locator('.highlights li a').first())
    await goneTo()
    await until(async () => !await panel.isVisible(), 'choosing a highlight left the panel open')
    const shownPages = await page.evaluate(() => {
        const renderer = document.querySelector('foliate-view').renderer
        const root = renderer.getContents()[0].doc.documentElement
        const style = getComputedStyle(root)
        return Math.max(1, Math.round(renderer.size / (parseFloat(style.columnWidth) + parseFloat(style.columnGap))))
    })
    const onIt = await counted(page, 5000)
    panel = await openHighlights(page)
    listed = await rows(panel)
    await escape(page, panel, 'Contents')
    const at = Number(/^Chapter One · page (\d+)$/.exec(listed[0]?.where ?? '')?.[1])
    if (listed.length !== 1 || !(at >= onIt.page && at < onIt.page + shownPages)) fail(`with Pages the Highlights tab lists ${JSON.stringify(listed)}; the screen shows pages ${onIt.page} to ${onIt.page + shownPages - 1}`)
    pass(`with Pages the highlight shows '${listed[0].where}', a page on screen when the reader goes to it`)
    await page.close()

    // A comic offers no highlighting.
    const comic = await open(context, comicId)
    if (await comic.locator('#selection-toolbar').count()) fail('a comic has the Selected text toolbar')
    await showControls(comic)
    await use(comic.getByRole('button', { name: 'Contents' }))
    await until(() => comic.locator('#contents').isVisible(), 'Contents did not open on the comic')
    const comicTabs = (await comic.locator('#contents').getByRole('tab').allInnerTexts()).map(text => text.trim())
    if (comicTabs.join('|') !== 'Contents|Bookmarks') fail(`a comic's Contents tabs are ${comicTabs.join(', ')}`)
    pass('a comic offers no highlighting and no Highlights tab')

    if (elsewhere.length) fail(`requests went to other hosts: ${[...new Set(elsewhere)].join(', ')}`)
    pass(`no request went to any host but ${origin}`)
} catch (error) {
    console.error(`FAIL: ${browserName}: ${error.message}`)
    failed = true
} finally {
    await clear(itemId).catch(() => {})
    // WebKit can hang while closing; the result is already known, so stop waiting.
    await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 10_000))])
}
process.exit(failed ? 1 : 0)
