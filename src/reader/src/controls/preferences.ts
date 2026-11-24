import { ownTheme, type OwnTheme, ownThemeOf, type Settings, startingColours, themeShown } from '../settings/settings'
import { closeButton, element } from './elements'
import type { OwnFonts } from './fonts'
import { createHighlighterDelete, type HighlighterDelete } from './highlighter-delete'
import { createHighlighterList } from './highlighter-list'
import type { HighlighterSheet } from './highlighter-sheet'
import type { Highlighters } from './highlighters'
import type { Highlights } from './highlights'
import { icon, ICONS } from './icons'
import { createOwnFontsSheet } from './own-fonts-sheet'
import { createChecks } from './prefs-checks'
import { createFontChoices } from './prefs-fonts'
import { createMargins } from './prefs-margins'
import { createPageTurns } from './prefs-page-turn'
import { createProgressChoice } from './prefs-progress'
import { createReset, type ResetChoice } from './prefs-reset'
import type { PrefsContext } from './prefs-section'
import { createSteppers } from './prefs-steppers'
import { createThemeChoices } from './prefs-themes'
import { createThemeSheet, type ThemeSheet } from './theme-sheet'
import type { OwnThemes } from './themes'

/** What Preferences shows and changes. */
export interface PreferencesOptions {
    /** The book's title, for the theme sheet's preview. */
    title: string
    /** The settings the reader opened with. */
    settings: Settings
    /** The reader's own fonts, kept on the server. */
    fonts: OwnFonts
    /** Whether the server lets readers add fonts; without it there is no Add font and no Your fonts. */
    fontUploads: boolean
    /** The reader's own themes, kept on the server. */
    themes: OwnThemes
    /** The reader's highlighters and the sheet that adds and edits them; null for comics and PDFs. */
    highlighters: Highlighters | null
    highlighterSheet: HighlighterSheet | null
    highlights: Highlights | null
    /** True for comics and PDFs, whose pages have no text to restyle. */
    fixedLayout: boolean
    /** True on a screen wider than a phone's, whose margins start wider. */
    wide(): boolean
    /** Applies and keeps settings chosen; `before` is what they were. */
    change(settings: Settings, before: Settings): void
}

/** Preferences, with Your fonts and the theme sheet in its place. */
export interface Preferences {
    backdrop: HTMLElement
    panel: HTMLElement
    close: HTMLButtonElement
    reset: ResetChoice
    highlighterDelete: HighlighterDelete
    themeSheet: ThemeSheet
    /** The settings as they are. */
    settings(): Settings
    /** Shows Preferences itself, with Close focused. */
    opened(): void
    /** Fills the list of highlighters. */
    fillHighlighters(): void
}

/** Preferences: a sheet or panel like Contents. Each choice applies at once. */
export const createPreferences = (options: PreferencesOptions): Preferences => {
    const backdrop = element('div', { id: 'prefs-backdrop', 'data-controls': '' })
    const panel = element('section', { id: 'prefs', 'data-controls': '', 'aria-label': 'Preferences' })
    const close = closeButton()
    // Your fonts, New theme and Edit theme take Preferences' place, with Back before the title.
    const back = element('button', { type: 'button', class: 'icon-button back', 'aria-label': 'Back', hidden: '' }, icon(ICONS.back))
    const header = element('div', { class: 'panel-header' }, '<h2>Preferences</h2>')
    const title = header.querySelector('h2')!
    header.prepend(back)
    header.append(close)
    const body = element('div', { class: 'panel-body' }, '<p class="note"></p>')
    const note = body.querySelector<HTMLElement>('.note')!

    let settings = options.settings
    const context: PrefsContext = {
        settings: () => settings,
        choose(changed) {
            const before = settings
            settings = { ...settings, ...changed }
            options.change(settings, before)
            fill()
        },
        wide: () => options.wide(),
        fixedLayout: options.fixedLayout,
    }
    const themes = createThemeChoices(context, options.themes, theme => openTheme(theme))
    const fonts = createFontChoices(context, options.fonts, options.fontUploads)
    const steppers = createSteppers(context)
    const margins = createMargins(context)
    const checks = createChecks(context)
    const reset = createReset(context)
    const pageTurns = createPageTurns(context)
    const progress = createProgressChoice(context)
    const highlighterDelete = createHighlighterDelete(options.highlighters, options.highlights)
    const highlighterList = createHighlighterList(options.highlighters, options.highlighterSheet, id => { void highlighterDelete.ask(id) })
    highlighterList.fill()
    const ownFonts = createOwnFontsSheet(context, options.fonts)
    // New theme and Edit theme, and the dialog Delete theme asks in.
    const themeSheet = createThemeSheet({
        themes: options.themes,
        title: options.title,
        inUse: () => ownThemeOf(settings.theme),
        saved: (id, added) => {
            if (added) context.choose({ theme: ownTheme(id) })
        },
        deletedInUse: () => context.choose({ theme: 'light' }),
        done: () => backToPrefs(),
    })
    panel.append(header, body, ownFonts.body, themeSheet.body)
    const openTheme = (editing: OwnTheme | null): void => {
        const start = startingColours(editing ?? themeShown(settings.theme, options.themes.list()))
        showSheet('theme', themeSheet.open(editing, start))
        back.focus()
    }

    // Which of Preferences, Your fonts and the theme sheet shows.
    const showSheet = (sheet: 'fonts' | 'theme' | null, name = 'Preferences'): void => {
        body.hidden = sheet !== null
        ownFonts.body.hidden = sheet !== 'fonts'
        themeSheet.body.hidden = sheet !== 'theme'
        back.hidden = sheet === null
        title.textContent = name
        panel.setAttribute('aria-label', name)
        if (sheet) panel.dataset.sheet = sheet
        else delete panel.dataset.sheet
        if (sheet !== 'fonts') ownFonts.clearMessage()
    }
    // Back to Preferences, focusing what opened the sheet.
    const backToPrefs = (): void => {
        const from = panel.dataset.sheet
        showSheet(null)
        if (from === 'fonts') fonts.add.focus()
        else themes.focus()
    }
    fonts.add.addEventListener('click', () => {
        showSheet('fonts', 'Your fonts')
        back.focus()
    })
    back.addEventListener('click', backToPrefs)

    body.append(themes.box, fonts.box, steppers.box, margins.box, pageTurns.box, progress.box, checks.box)
    if (options.highlighters) body.append(highlighterList.box)
    body.append(reset.button)
    const sections = [themes, fonts, steppers, margins, pageTurns, progress, checks]
    const fill = (): void => {
        // What stays on this screen, and what follows the reader.
        note.textContent = `Size, spacing, margins and page turn apply to this ${options.wide() ? 'computer' : 'phone'}. Themes, fonts and highlighters follow you on every device.`
        for (const section of sections) section.fill()
    }
    options.themes.onChange(() => {
        themes.refresh()
        fill()
    })
    options.fonts.onChange(() => {
        fonts.refresh()
        ownFonts.fill()
        fill()
    })
    ownFonts.fill()
    fill()

    return {
        backdrop,
        panel,
        close,
        reset,
        highlighterDelete,
        themeSheet,
        settings: () => settings,
        opened() {
            showSheet(null)
            close.focus()
        },
        fillHighlighters: () => highlighterList.fill(),
    }
}
