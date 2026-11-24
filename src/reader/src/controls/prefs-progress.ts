import type { Progress } from '../settings/settings'
import { element } from './elements'
import type { PrefsContext, PrefsSection } from './prefs-section'

// The Progress choices: the setting and its name.
const PROGRESS_CHOICES: [Progress, string][] = [['percent', 'Percentage'], ['pages', 'Pages']]

/** Progress: the percent read, or page / total. */
export const createProgressChoice = (context: PrefsContext): PrefsSection => {
    const box = element('div', { class: 'progress-row' }, '<span class="stepper-name">Progress</span>')
    const group = element('div', { role: 'radiogroup', 'aria-label': 'Progress', class: 'segments' })
    box.append(group)
    const buttons = PROGRESS_CHOICES.map(([setting, name]) => {
        const button = element('button', { type: 'button', role: 'radio', 'aria-checked': 'false' })
        button.textContent = name
        button.addEventListener('click', () => context.choose({ progress: setting }))
        group.append(button)
        return { setting, button }
    })
    return {
        box,
        fill() {
            for (const { setting, button } of buttons) button.setAttribute('aria-checked', String(context.settings().progress === setting))
        },
    }
}
