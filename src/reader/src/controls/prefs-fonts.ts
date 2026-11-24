import { FONTS, type FontName, fontStack, ownFont } from '../settings/settings'
import { choiceGroup, element } from './elements'
import type { OwnFonts } from './fonts'
import { icon, ICONS } from './icons'
import type { PrefsContext, PrefsSection } from './prefs-section'

/** Preferences' fonts. */
export interface FontChoices extends PrefsSection {
    /** Opens Your fonts. */
    add: HTMLButtonElement
    /** Draws the buttons again, as when the reader's own fonts change. */
    refresh(): void
}

/** The bundled fonts, then the reader's own families, then Add font while the server allows adding fonts (`uploads`). */
export const createFontChoices = (context: PrefsContext, ownFonts: OwnFonts, uploads: boolean): FontChoices => {
    const fonts = choiceGroup('Font')
    let buttons: HTMLButtonElement[] = []
    const add = element('button', { type: 'button', class: 'font add', 'aria-label': 'Add font' }, `${icon(ICONS.upload)}Add font`)
    const refresh = (): void => {
        const builtIn = (Object.keys(FONTS) as FontName[]).map(name => ({ name, choice: name, own: false }))
        const own = ownFonts.families().map(family => ({ name: family.name, choice: ownFont(family.name), own: true }))
        buttons = [...builtIn, ...own].map(({ name, choice, own: mine }) => {
            const button = element('button', { type: 'button', class: mine ? 'font own' : 'font', 'aria-pressed': 'false', 'data-font': choice }, mine ? icon(ICONS.upload) : '')
            button.append(name)
            button.style.fontFamily = fontStack(choice)
            button.addEventListener('click', () => context.choose({ font: choice }))
            return button
        })
        fonts.row.replaceChildren(...buttons, ...uploads ? [add] : [])
    }
    refresh()
    return {
        box: fonts.box,
        add,
        refresh,
        fill() {
            const settings = context.settings()
            for (const button of buttons) {
                button.setAttribute('aria-pressed', String(button.dataset.font === settings.font))
                button.disabled = context.fixedLayout || settings.bookLayout
            }
        },
    }
}
