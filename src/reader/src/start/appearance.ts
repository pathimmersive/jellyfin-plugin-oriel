import type { ChosenOnServer } from '../controls/choices'
import type { OwnFonts } from '../controls/fonts'
import type { OwnThemes } from '../controls/themes'
import { fontFaces } from '../settings/fonts'
import { bookStyles, choicesOf, controlsColours, type KeptChoices, ownFamilyOf, type OwnTheme, pageColours, readSettings, type Settings, themeShown, withChoices, writeSettings } from '../settings/settings'

/** What the reader has of its own on the server, once it is read. */
export interface OwnAppearance {
    fonts: OwnFonts
    themes: OwnThemes
    chosen: ChosenOnServer
    /** Whether the reader's fonts could be read. */
    fontsRead: boolean
    /** The theme and font the server keeps; null to keep this device's. */
    kept: KeptChoices | null
}

/** How the book and the page around it look. */
export interface Appearance {
    /** The settings as they are. */
    settings(): Settings
    /** The stylesheet of the book's sections. */
    styles(): string
    /** Takes what the reader has of its own, before the first page shows. */
    use(own: OwnAppearance): void
    /** Applies and keeps settings; true when the book's stylesheet changes with them. */
    change(changed: Settings): boolean
    /** Declares the reader's fonts again, as when they change. */
    declareFonts(): void
    /** Colours the page again, as when a theme of the reader's own changes. */
    theme(): void
}

// The page around the book takes the theme: its background and the reading
// footer's colour, and with a custom theme the controls' colours too.
const themePage = (settings: Settings, own: readonly OwnTheme[]): void => {
    const shown = themeShown(settings.theme, own)
    const theme = pageColours(shown)
    const root = document.documentElement
    root.style.setProperty('--page-background', theme.background)
    root.style.setProperty('--page-footer', theme.footer)
    const controls = typeof shown === 'string' ? null : controlsColours(shown)
    for (const name of ['--chrome', '--chrome-ink', '--sub', '--accent', '--accent-ink', '--divider', '--raised', '--grayed']) {
        if (controls) root.style.setProperty(name, controls[name])
        else root.style.removeProperty(name)
    }
    root.toggleAttribute('data-own-theme', !!controls)
}

/**
 * The settings kept on this device, applied before the first page shows. The
 * bundled fonts are declared here too, for Preferences' font buttons.
 */
export const createAppearance = (storage: Pick<Storage, 'getItem' | 'setItem'>): Appearance => {
    let settings = readSettings(storage)
    let faces = fontFaces()
    let own: OwnAppearance | null = null
    const fontStyle = document.createElement('style')
    fontStyle.textContent = faces
    document.head.append(fontStyle)
    const ownThemes = (): readonly OwnTheme[] => own?.themes.list() ?? []
    const theme = (): void => themePage(settings, ownThemes())
    const styles = (chosen: Settings): string => bookStyles(chosen, faces, ownThemes())
    const keep = (kept: Settings): void => {
        settings = kept
        writeSettings(storage, settings)
    }
    const declareFonts = (): void => {
        faces = [fontFaces(), own?.fonts.faces() ?? ''].filter(Boolean).join('\n')
        fontStyle.textContent = faces
    }
    theme()
    return {
        settings: () => settings,
        styles: () => styles(settings),
        use(read) {
            own = read
            keep(withChoices(settings, read.kept))
            theme()
            // A chosen family the reader no longer has goes back to Default.
            const family = ownFamilyOf(settings.font)
            if (read.fontsRead && family !== null && !read.fonts.has(family)) keep({ ...settings, font: 'Default' })
            declareFonts()
        },
        change(changed) {
            const restyle = styles(changed) !== styles(settings)
            if (changed.theme !== settings.theme || changed.font !== settings.font) own?.chosen.choose(choicesOf(changed))
            keep(changed)
            theme()
            return restyle
        },
        declareFonts,
        theme,
    }
}
