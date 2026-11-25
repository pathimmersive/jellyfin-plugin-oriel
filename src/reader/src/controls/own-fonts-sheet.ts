import { fontStack, ownFamilyOf, ownFont } from '../settings/settings'
import { element } from './elements'
import { type OwnFonts, stylesOf } from './fonts'
import { icon, ICONS } from './icons'
import type { PrefsContext } from './prefs-section'

/** Your fonts, in Preferences' place. */
export interface OwnFontsSheet {
    body: HTMLElement
    /** Fills the list of families. */
    fill(): void
    /** Takes away what was last said about a file or a family. */
    clearMessage(): void
}

/** Your fonts: add a file, and each family with its styles and Remove. */
export const createOwnFontsSheet = (context: PrefsContext, fonts: OwnFonts): OwnFontsSheet => {
    const body = element('div', { class: 'panel-body your-fonts', hidden: '' },
        '<p class="about">Fonts you add are yours and appear on all your devices. TTF, OTF or WOFF2, up to 5 MB each. Only add fonts you are allowed to use.</p>'
        + `<label class="add-font">${icon(ICONS.upload)}Add a font<input type="file" accept=".ttf,.otf,.woff2"></label>`
        + '<p class="message" role="status"></p><div class="own-fonts"><span class="group-label">Your fonts</span><ul></ul></div>')
    const fontFile = body.querySelector<HTMLInputElement>('input[type="file"]')!
    const message = body.querySelector<HTMLElement>('.message')!
    const list = body.querySelector('.own-fonts ul')!
    const add = async (): Promise<void> => {
        const [file] = fontFile.files ?? []
        fontFile.value = ''
        if (!file) return
        message.textContent = `Adding ${file.name}…`
        message.textContent = await fonts.add(file) ?? ''
    }
    fontFile.addEventListener('change', () => { void add() })
    const removeFamily = async (name: string): Promise<void> => {
        message.textContent = ''
        if (!await fonts.remove(name)) {
            message.textContent = `${name} could not be removed. Try again.`
            return
        }
        if (ownFamilyOf(context.settings().font) === name) context.choose({ font: 'Default' })
    }
    return {
        body,
        fill() {
            const families = fonts.families()
            body.querySelector<HTMLElement>('.own-fonts')!.hidden = !families.length
            list.replaceChildren(...families.map(family => {
                const row = element('li', {}, '<span class="names"><span class="family"></span><span class="styles"></span></span>')
                const name = row.querySelector<HTMLElement>('.family')!
                name.textContent = family.name
                name.style.fontFamily = fontStack(ownFont(family.name))
                row.querySelector('.styles')!.textContent = stylesOf(family)
                const remove = element('button', { type: 'button', class: 'icon-button', 'aria-label': `Remove ${family.name}` }, icon(ICONS.trash))
                remove.addEventListener('click', () => { void removeFamily(family.name) })
                row.append(remove)
                return row
            }))
        },
        clearMessage() {
            message.textContent = ''
        },
    }
}
