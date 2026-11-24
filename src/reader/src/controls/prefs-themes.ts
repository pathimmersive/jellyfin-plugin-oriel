import { MAX_THEMES, ownTheme, type OwnTheme, type ThemeChoice, THEMES, type ThemeId } from '../settings/settings'
import { choiceGroup, element } from './elements'
import { icon, ICONS } from './icons'
import type { PrefsContext, PrefsSection } from './prefs-section'
import type { OwnThemes } from './themes'

/** Preferences' themes. */
export interface ThemeChoices extends PrefsSection {
    /** Draws the cards again, as when the reader's own themes change. */
    refresh(): void
    /** Focuses the theme in use, or Add when it is not listed. */
    focus(): void
}

const themeCard = (choice: ThemeChoice, name: string, label: string, colours: { background: string, text: string }): HTMLButtonElement => {
    const button = element('button', { type: 'button', class: 'theme', 'aria-label': label, 'aria-pressed': 'false', 'data-theme': choice }, '<span class="swatch">Aa</span><span class="name"></span>')
    button.querySelector<HTMLElement>('.swatch')!.style.cssText = `background: ${colours.background}; color: ${colours.text}`
    button.querySelector('.name')!.textContent = name
    return button
}

/**
 * The built-in themes, then the reader's own with an edit badge, then Add
 * while the reader has fewer than 12. A custom theme's card, once chosen,
 * opens Edit theme: `edit` is called with it, or with null for a new theme.
 */
export const createThemeChoices = (context: PrefsContext, ownThemes: OwnThemes, edit: (theme: OwnTheme | null) => void): ThemeChoices => {
    const themes = choiceGroup('Theme')
    let buttons: HTMLButtonElement[] = []
    const add = element('button', { type: 'button', class: 'theme add', 'aria-label': 'Add a theme' }, '<span class="swatch">+</span><span class="name">Add</span>')
    add.addEventListener('click', () => edit(null))
    const refresh = (): void => {
        const builtIn = (Object.keys(THEMES) as ThemeId[]).map(id => {
            const button = themeCard(id, THEMES[id].name, THEMES[id].name, THEMES[id])
            button.addEventListener('click', () => context.choose({ theme: id }))
            return button
        })
        const own = ownThemes.list().map(theme => {
            const choice = ownTheme(theme.id)
            const button = themeCard(choice, theme.name, `${theme.name}, a custom theme; open it to edit`, theme)
            const badge = element('span', { class: 'badge' }, icon(ICONS.edit))
            badge.style.cssText = `background: ${theme.controls}; color: ${theme.controlsText}`
            button.querySelector('.swatch')!.append(badge)
            button.addEventListener('click', () => {
                if (context.settings().theme === choice) edit(theme)
                else context.choose({ theme: choice })
            })
            return button
        })
        buttons = [...builtIn, ...own]
        add.hidden = own.length >= MAX_THEMES
        themes.row.replaceChildren(...buttons, add)
    }
    refresh()
    return {
        box: themes.box,
        refresh,
        fill() {
            for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.theme === context.settings().theme))
        },
        focus: () => (buttons.find(button => button.dataset.theme === context.settings().theme) ?? add).focus(),
    }
}
