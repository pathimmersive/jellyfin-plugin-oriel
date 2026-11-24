import { element } from './elements'
import type { PrefsContext, PrefsSection } from './prefs-section'

// The checkboxes: the setting and its label.
type Check = 'justify' | 'hyphenate' | 'bookLayout'
const CHECKS: [Check, string][] = [
    ['justify', 'Justify text'],
    ['hyphenate', 'Hyphenate words'],
    ['bookLayout', "Use the book's layout and fonts"],
]

/** Justify, hyphenate and the book's own layout. */
export const createChecks = (context: PrefsContext): PrefsSection => {
    const box = element('div', { class: 'checks' })
    const checkboxes = CHECKS.map(([setting, name]) => {
        const label = element('label', {}, '<input type="checkbox"><span></span>')
        label.querySelector('span')!.textContent = name
        const input = label.querySelector('input')!
        input.addEventListener('change', () => context.choose({ [setting]: input.checked }))
        box.append(label)
        return { setting, input }
    })
    return {
        box,
        fill() {
            const settings = context.settings()
            for (const { setting, input } of checkboxes) {
                input.checked = settings[setting]
                input.disabled = context.fixedLayout || (settings.bookLayout && setting !== 'bookLayout')
            }
        },
    }
}
