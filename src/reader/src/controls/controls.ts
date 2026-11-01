import { FONTS, type FontName, INDENT, type PageTurn, type Progress, LINE_SPACING, MARGIN, marginsFor, PARAGRAPH_SPACING, type Range, resetLayout, type Settings, SIDES, SIZE, stepIn, stepSize, THEMES, type ThemeId } from '../settings/settings'
import type { ContentsRow } from './contents'
import { pagesLeftName, percent, type ProgressShown } from './progress'
import { type ControlsEvent, type ControlsState, HIDDEN, nextControls } from './state'

/** What the controls show and where their links go. */
export interface ControlsOptions {
    /** The book's title, for the header. */
    title: string
    /** The book's details page in jellyfin-web. */
    detailsUrl: string
    /** Your reading data for this book. */
    dataUrl: string
    /** Goes to a fraction of the book, as a reader move. */
    seek(fraction: number): Promise<void>
    /** The Contents panel's rows, with the entry being read marked. */
    contents(): ContentsRow[]
    /** Goes to a contents entry's link, as a reader move. */
    choose(href: string): Promise<void>
    /** The settings the reader opened with. */
    settings: Settings
    /** True for comics and PDFs, whose pages have no text to restyle. */
    fixedLayout: boolean
    /** True on a screen wider than a phone's, whose margins start wider. */
    wide(): boolean
    /** Applies and keeps settings chosen in Preferences. */
    change(settings: Settings): void
}

/** The reader's controls, as the page drives them. */
export interface Controls {
    /** A tap or click in the middle of the page. */
    middle(): void
    /** A page turned by the reader. */
    turned(): void
    /**
     * The place now shown: its chapter's name (empty for none), the fraction
     * of the book, the progress to show, and the pages left in the chapter
     * (null for a book without pages).
     */
    locate(chapter: string, fraction: number, progress: ProgressShown, left: number | null): void
}

// Material icons, as the canvas draws them.
const ICONS = {
    back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
    more: 'M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
    data: 'M9 3L5 6.99h3V14h2V6.99h3L9 3zm7 14.01V10h-2v7.01h-3L15 21l4-3.99h-3z',
    info: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z',
    toc: 'M3 9h14V7H3v2zm0 4h14v-2H3v2zm0 4h14v-2H3v2zm16 0h2v-2h-2v2zm0-10v2h2V7h-2zm0 6h2v-2h-2v2z',
    close: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    prefs: 'M5 3h2v6H5zM5 13h2v8H5zM3 9h6v4H3zM11 3h2v2h-2zM11 9h2v12h-2zM9 5h6v4H9zM17 3h2v10h-2zM17 17h2v4h-2zM15 13h6v4h-6z',
    down: 'M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z',
    up: 'M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6 1.41 1.41z',
    reset: 'M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z',
    toEnd: 'M5.59 7.41L10.18 12l-4.59 4.59L7 18l6-6-6-6zM16 6h2v12h-2z',
    slide: 'M4 6h2v12H4zm4 0h12v12H8z',
    scroll: 'M12 4l-4 4h3v8H8l4 4 4-4h-3V8h3z',
    fade: 'M12 3a9 9 0 100 18 9 9 0 000-18zm0 16V5a7 7 0 010 14z',
    none: 'M6 5h12v14H6z',
}

// The page turns: the setting, its name and its icon, as the canvas draws them.
const PAGE_TURN_CHOICES: [PageTurn, string, keyof typeof ICONS][] = [
    ['slide', 'Slide', 'slide'],
    ['scroll', 'Scroll', 'scroll'],
    ['fade', 'Fade', 'fade'],
    ['none', 'None', 'none'],
]

// The Progress choices: the setting and its name.
const PROGRESS_CHOICES: [Progress, string][] = [['percent', 'Percentage'], ['pages', 'Pages']]

// The spacing steppers: the setting, its name, its range and how its value reads.
type Spacing = 'lineSpacing' | 'paragraphSpacing' | 'indent'
const SPACINGS: [Spacing, string, Range, (value: number) => string][] = [
    ['lineSpacing', 'Line spacing', LINE_SPACING, value => value.toFixed(1)],
    ['paragraphSpacing', 'Paragraph spacing', PARAGRAPH_SPACING, value => `${value.toFixed(1)} em`],
    ['indent', 'Indent', INDENT, value => `${value.toFixed(1)} em`],
]

// The checkboxes: the setting and its label.
type Check = 'justify' | 'hyphenate' | 'bookLayout'
const CHECKS: [Check, string][] = [
    ['justify', 'Justify text'],
    ['hyphenate', 'Hyphenate words'],
    ['bookLayout', "Use the book's layout and fonts"],
]

const icon = (path: string): string =>
    `<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="${path}"/></svg>`

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Record<string, string> = {}, html = ''): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag)
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value)
    node.innerHTML = html
    return node
}

// A stepper's value between its Less and More buttons, with its name before them.
const stepper = (setting: string, name: string, down: HTMLButtonElement, up: HTMLButtonElement, className = 'stepper'): { row: HTMLElement, value: HTMLElement } => {
    const row = element('div', { class: className, 'data-setting': setting })
    const label = element('span', { class: 'stepper-name' })
    label.textContent = name
    const value = element('span', { class: 'value' })
    const controls = element('div', { class: 'stepper-controls' })
    controls.append(down, value, up)
    row.append(label, controls)
    return { row, value }
}

const stepButton = (label: string, path: string): HTMLButtonElement =>
    element('button', { type: 'button', class: 'step', 'aria-label': label }, icon(path))

const closeButton = (): HTMLButtonElement =>
    element('button', { type: 'button', class: 'icon-button', 'aria-label': 'Close' }, icon(ICONS.close))

interface PlaceRow {
    row: HTMLElement
    chapter: HTMLElement
    counting: HTMLElement
    progress: HTMLElement
    left: HTMLElement
}

// The chapter, the progress and the pages left in the chapter, as both footers show them.
const placeRow = (): PlaceRow => {
    const row = element('div', { class: 'place' })
    const chapter = element('span', { class: 'chapter' })
    const counting = element('span', { class: 'counting' })
    counting.textContent = 'Counting pages'
    counting.hidden = true
    const progress = element('span', { class: 'progress' })
    const left = element('span', { class: 'left', role: 'img' }, `<span class="count"></span>${icon(ICONS.toEnd)}`)
    left.hidden = true
    const status = element('span', { class: 'status' })
    status.append(counting, progress, left)
    row.append(chapter, status)
    return { row, chapter, counting, progress, left }
}

/**
 * Adds the reader's controls to `root`: a reading footer shown while reading,
 * and the header, footer and More shown by a tap in the middle of the page.
 */
export const createControls = (root: HTMLElement, options: ControlsOptions): Controls => {
    const reading = placeRow()
    reading.row.id = 'reading-footer'

    const back = element('a', { class: 'icon-button', href: options.detailsUrl, 'aria-label': 'Back to the book in Jellyfin' }, icon(ICONS.back))
    const title = element('span', { class: 'title' })
    title.textContent = options.title
    const contentsButton = element('button', { type: 'button', class: 'icon-button', 'aria-label': 'Contents', 'aria-expanded': 'false', 'aria-controls': 'contents' }, icon(ICONS.toc))
    const prefsButton = element('button', { type: 'button', class: 'icon-button', 'aria-label': 'Preferences', 'aria-expanded': 'false', 'aria-controls': 'prefs' }, icon(ICONS.prefs))
    const moreButton = element('button', { type: 'button', class: 'icon-button', 'aria-label': 'More', 'aria-haspopup': 'true', 'aria-expanded': 'false', 'aria-controls': 'more' }, icon(ICONS.more))
    const header = element('header')
    header.append(back, title, contentsButton, prefsButton, moreButton)

    const place = placeRow()
    const slider = element('input', { type: 'range', min: '0', max: '100', step: 'any', value: '0', 'aria-label': 'Position in the book' })
    const footer = element('footer')
    footer.append(place.row, slider)

    const bar = element('div', { id: 'controls', 'data-controls': '' })
    bar.append(header, footer)

    const backdrop = element('div', { id: 'more-backdrop', 'data-controls': '' })
    const more = element('nav', { id: 'more', 'data-controls': '', 'aria-label': 'More' })
    const link = (href: string, path: string, name: string): HTMLAnchorElement => {
        const a = element('a', { href }, `${icon(path)}<span></span>`)
        a.querySelector('span')!.textContent = name
        return a
    }
    more.append(link(options.dataUrl, ICONS.data, 'Your reading data'), link(options.detailsUrl, ICONS.info, 'Book details in Jellyfin'))

    // Contents: a sheet over a dimmed page on a phone, a panel beside the page on a wider screen.
    const contentsBackdrop = element('div', { id: 'contents-backdrop', 'data-controls': '' })
    const contents = element('section', { id: 'contents', 'data-controls': '', 'aria-label': 'Contents' })
    const contentsTitle = element('h2')
    contentsTitle.textContent = options.title
    const close = closeButton()
    const contentsHeader = element('div', { class: 'panel-header' })
    contentsHeader.append(contentsTitle, close)
    const contentsBody = element('div', { class: 'panel-body' })
    contents.append(contentsHeader, contentsBody)
    const fillContents = (): void => {
        const rows = options.contents()
        if (!rows.length) {
            contentsBody.replaceChildren(element('p', { class: 'empty' }, `${icon(ICONS.toc)}<span>This book has no table of contents.</span>`))
            return
        }
        const list = element('ol')
        for (const row of rows) {
            const entry = element(row.href ? 'a' : 'span', { class: 'entry', style: `--depth: ${row.depth}` }, '<span class="label"></span><span class="where"></span>')
            entry.querySelector('.label')!.textContent = row.label
            entry.querySelector('.where')!.textContent = row.where
            if (row.href) {
                entry.setAttribute('href', '#')
                entry.addEventListener('click', event => {
                    event.preventDefault()
                    apply('chosen')
                    void options.choose(row.href)
                })
            }
            if (row.current) entry.setAttribute('aria-current', 'true')
            const item = element('li')
            item.append(entry)
            list.append(item)
        }
        contentsBody.replaceChildren(list)
    }

    // Preferences: a sheet or panel like Contents. Each choice applies at once.
    const prefsBackdrop = element('div', { id: 'prefs-backdrop', 'data-controls': '' })
    const prefs = element('section', { id: 'prefs', 'data-controls': '', 'aria-label': 'Preferences' })
    const prefsClose = closeButton()
    const prefsHeader = element('div', { class: 'panel-header' }, '<h2>Preferences</h2>')
    prefsHeader.append(prefsClose)
    const prefsBody = element('div', { class: 'panel-body' }, '<p class="note">Your preferences apply to this device.</p>')
    prefs.append(prefsHeader, prefsBody)
    let settings = options.settings
    const group = (name: string): { box: HTMLElement, row: HTMLElement } => {
        const box = element('div', { role: 'group', 'aria-label': name, class: 'choices' })
        const label = element('span', { class: 'group-label' })
        label.textContent = name
        const row = element('div', { class: 'choice-row' })
        box.append(label, row)
        return { box, row }
    }
    const themes = group('Theme')
    const themeButtons = (Object.keys(THEMES) as ThemeId[]).map(id => {
        const theme = THEMES[id]
        const button = element('button', { type: 'button', class: 'theme', 'aria-label': theme.name, 'aria-pressed': 'false', 'data-theme': id }, '<span class="swatch">Aa</span><span class="name"></span>')
        button.querySelector<HTMLElement>('.swatch')!.style.cssText = `background: ${theme.background}; color: ${theme.text}`
        button.querySelector('.name')!.textContent = theme.name
        button.addEventListener('click', () => choose({ theme: id }))
        themes.row.append(button)
        return button
    })
    const fonts = group('Font')
    const fontButtons = (Object.keys(FONTS) as FontName[]).map(name => {
        const button = element('button', { type: 'button', class: 'font', 'aria-pressed': 'false', 'data-font': name })
        button.textContent = name
        button.style.fontFamily = FONTS[name]
        button.disabled = options.fixedLayout
        button.addEventListener('click', () => choose({ font: name }))
        fonts.row.append(button)
        return button
    })
    const smaller = element('button', { type: 'button', class: 'step', 'aria-label': 'Less size' }, '<span class="small-a">A</span>')
    const larger = element('button', { type: 'button', class: 'step', 'aria-label': 'More size' }, '<span class="large-a">A</span>')
    const size = stepper('size', 'Size', smaller, larger)
    smaller.addEventListener('click', () => choose({ size: stepSize(settings.size, -1) }))
    larger.addEventListener('click', () => choose({ size: stepSize(settings.size, 1) }))
    const steppers = element('div', { class: 'steppers' })
    steppers.append(size.row)
    const spacings = SPACINGS.map(([setting, name, range, read]) => {
        const down = stepButton(`Less ${name.toLowerCase()}`, ICONS.down)
        const up = stepButton(`More ${name.toLowerCase()}`, ICONS.up)
        const { row, value } = stepper(setting, name, down, up)
        down.addEventListener('click', () => choose({ [setting]: stepIn(range, settings[setting], -1) }))
        up.addEventListener('click', () => choose({ [setting]: stepIn(range, settings[setting], 1) }))
        steppers.append(row)
        return { setting, range, read, down, value, up }
    })

    // Margins, in px: the screen's defaults until one is changed.
    const margins = element('div', { role: 'group', 'aria-label': 'Margins in pixels', class: 'margins' }, '<span class="group-label">Margins (px)</span>')
    const marginGrid = element('div', { class: 'margin-grid' })
    margins.append(marginGrid)
    const marginSteppers = SIDES.map(side => {
        const name = side[0].toUpperCase() + side.slice(1)
        const down = stepButton(`Less ${side} margin`, ICONS.down)
        const up = stepButton(`More ${side} margin`, ICONS.up)
        const { row, value } = stepper(`margin-${side}`, name, down, up, 'margin')
        const move = (step: -1 | 1): void => {
            const shown = marginsFor(settings, options.wide())
            choose({ margins: { ...shown, [side]: stepIn(MARGIN, shown[side], step) } })
        }
        down.addEventListener('click', () => move(-1))
        up.addEventListener('click', () => move(1))
        marginGrid.append(row)
        return { side, down, value, up }
    })

    const checks = element('div', { class: 'checks' })
    const checkboxes = CHECKS.map(([setting, name]) => {
        const label = element('label', {}, '<input type="checkbox"><span></span>')
        label.querySelector('span')!.textContent = name
        const box = label.querySelector('input')!
        box.addEventListener('change', () => choose({ [setting]: box.checked }))
        checks.append(label)
        return { setting, box }
    })

    // Reset to defaults asks first, in a dialog over everything.
    const resetButton = element('button', { type: 'button', class: 'reset' }, `${icon(ICONS.reset)}<span>Reset to defaults</span>`)
    const resetDialog = element('div', { id: 'reset-dialog', 'data-controls': '' })
    const dialog = element('div', { role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'reset-title', 'aria-describedby': 'reset-body' },
        '<h2 id="reset-title">Reset layout to the defaults?</h2><p id="reset-body"></p><div class="dialog-buttons"></div>')
    const cancel = element('button', { type: 'button', class: 'cancel' }, 'Cancel')
    const confirm = element('button', { type: 'button', class: 'confirm' }, 'Reset')
    dialog.querySelector('.dialog-buttons')!.append(cancel, confirm)
    resetDialog.append(dialog)
    resetDialog.hidden = true
    const closeReset = (): void => {
        resetDialog.hidden = true
        resetButton.focus()
    }
    resetButton.addEventListener('click', () => {
        dialog.querySelector('p')!.textContent = `Size, spacing, margins and page turn on this ${options.wide() ? 'computer' : 'phone'} go back to the defaults. Your theme and font stay as they are.`
        resetDialog.hidden = false
        cancel.focus()
    })
    cancel.addEventListener('click', closeReset)
    resetDialog.addEventListener('click', event => {
        if (event.target === resetDialog) closeReset()
    })
    confirm.addEventListener('click', () => {
        choose(resetLayout(settings))
        closeReset()
    })

    // Page turn: how pages turn.
    const pageTurns = group('Page turn')
    const pageTurnButtons = PAGE_TURN_CHOICES.map(([setting, name, path]) => {
        const button = element('button', { type: 'button', class: 'page-turn', 'aria-pressed': 'false' }, `${icon(ICONS[path])}<span></span>`)
        button.querySelector('span')!.textContent = name
        button.disabled = options.fixedLayout
        button.addEventListener('click', () => choose({ pageTurn: setting }))
        pageTurns.row.append(button)
        return { setting, button }
    })

    // Progress: the percent read, or page / total.
    const progressRow = element('div', { class: 'progress-row' }, '<span class="stepper-name">Progress</span>')
    const progressGroup = element('div', { role: 'radiogroup', 'aria-label': 'Progress', class: 'segments' })
    progressRow.append(progressGroup)
    const progressButtons = PROGRESS_CHOICES.map(([setting, name]) => {
        const button = element('button', { type: 'button', role: 'radio', 'aria-checked': 'false' })
        button.textContent = name
        button.addEventListener('click', () => choose({ progress: setting }))
        progressGroup.append(button)
        return { setting, button }
    })

    prefsBody.append(themes.box, fonts.box, steppers, margins, pageTurns.box, progressRow, checks, resetButton)
    const fillPrefs = (): void => {
        const fixed = options.fixedLayout
        const own = settings.bookLayout
        for (const button of themeButtons) button.setAttribute('aria-pressed', String(button.dataset.theme === settings.theme))
        for (const button of fontButtons) {
            button.setAttribute('aria-pressed', String(button.dataset.font === settings.font))
            button.disabled = fixed || own
        }
        size.value.textContent = String(settings.size)
        smaller.disabled = fixed || settings.size <= SIZE.min
        larger.disabled = fixed || settings.size >= SIZE.max
        for (const { setting, range, read, down, value, up } of spacings) {
            value.textContent = read(settings[setting])
            down.disabled = fixed || own || settings[setting] <= range.min
            up.disabled = fixed || own || settings[setting] >= range.max
        }
        const shown = marginsFor(settings, options.wide())
        for (const { side, down, value, up } of marginSteppers) {
            value.textContent = String(shown[side])
            down.disabled = fixed || shown[side] <= MARGIN.min
            up.disabled = fixed || shown[side] >= MARGIN.max
        }
        for (const { setting, button } of pageTurnButtons) button.setAttribute('aria-pressed', String(settings.pageTurn === setting))
        for (const { setting, button } of progressButtons) button.setAttribute('aria-checked', String(settings.progress === setting))
        for (const { setting, box } of checkboxes) {
            box.checked = settings[setting]
            box.disabled = fixed || (own && setting !== 'bookLayout')
        }
    }
    const choose = (changed: Partial<Settings>): void => {
        settings = { ...settings, ...changed }
        options.change(settings)
        fillPrefs()
    }
    fillPrefs()

    root.append(reading.row, bar, backdrop, more, contentsBackdrop, contents, prefsBackdrop, prefs, resetDialog)

    let state: ControlsState = HIDDEN
    const show = (): void => {
        bar.hidden = !state.shown
        reading.row.hidden = state.shown
        more.hidden = !state.more
        backdrop.hidden = !state.more
        moreButton.setAttribute('aria-expanded', String(state.more))
        contents.hidden = !state.contents
        contentsBackdrop.hidden = !state.contents
        contentsButton.setAttribute('aria-expanded', String(state.contents))
        prefs.hidden = !state.prefs
        prefsBackdrop.hidden = !state.prefs
        prefsButton.setAttribute('aria-expanded', String(state.prefs))
    }
    const apply = (event: ControlsEvent): void => {
        const opening = event === 'contents' && !state.contents
        const openingPrefs = event === 'prefs' && !state.prefs
        state = nextControls(state, event)
        show()
        if (opening) {
            // Fill on opening, so the entry being read is the one marked, and show it.
            fillContents()
            contentsBody.querySelector('[aria-current]')?.scrollIntoView({ block: 'center' })
            close.focus()
        }
        if (openingPrefs) prefsClose.focus()
    }
    show()

    moreButton.addEventListener('click', () => apply('more'))
    backdrop.addEventListener('click', () => apply('outside'))
    contentsButton.addEventListener('click', () => apply('contents'))
    contentsBackdrop.addEventListener('click', () => apply('outside'))
    close.addEventListener('click', () => apply('outside'))
    prefsButton.addEventListener('click', () => apply('prefs'))
    prefsBackdrop.addEventListener('click', () => apply('outside'))
    prefsClose.addEventListener('click', () => apply('outside'))
    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return
        if (!resetDialog.hidden) closeReset()
        else if (state.more || state.contents || state.prefs) apply('outside')
    })

    // The percent follows the slider while it moves; the book moves on release.
    slider.addEventListener('input', () => { place.progress.textContent = percent(Number(slider.value) / 100) })
    slider.addEventListener('change', () => { void options.seek(Number(slider.value) / 100) })

    return {
        middle: () => apply('middle'),
        turned: () => apply('turned'),
        locate(chapter, fraction, progress, left) {
            for (const row of [reading, place]) {
                row.chapter.textContent = chapter
                row.counting.hidden = !progress.counting
                row.progress.textContent = progress.text
                row.left.hidden = left === null
                if (left !== null) {
                    row.left.querySelector('.count')!.textContent = String(left)
                    row.left.setAttribute('aria-label', pagesLeftName(left))
                }
            }
            slider.value = String(fraction * 100)
        },
    }
}
