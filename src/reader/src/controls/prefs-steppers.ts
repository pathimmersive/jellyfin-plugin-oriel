import { INDENT, LINE_SPACING, PARAGRAPH_SPACING, type Range, SIZE, stepIn, stepSize } from '../settings/settings'
import { element, stepButton, stepper } from './elements'
import { ICONS } from './icons'
import type { PrefsContext, PrefsSection } from './prefs-section'

// The spacing steppers: the setting, its name, its range and how its value reads.
type Spacing = 'lineSpacing' | 'paragraphSpacing' | 'indent'
const SPACINGS: [Spacing, string, Range, (value: number) => string][] = [
    ['lineSpacing', 'Line spacing', LINE_SPACING, value => value.toFixed(1)],
    ['paragraphSpacing', 'Paragraph spacing', PARAGRAPH_SPACING, value => `${value.toFixed(1)} em`],
    ['indent', 'Indent', INDENT, value => `${value.toFixed(1)} em`],
]

/** Size and the spacings. */
export const createSteppers = (context: PrefsContext): PrefsSection => {
    const smaller = element('button', { type: 'button', class: 'step', 'aria-label': 'Less size' }, '<span class="small-a">A</span>')
    const larger = element('button', { type: 'button', class: 'step', 'aria-label': 'More size' }, '<span class="large-a">A</span>')
    const size = stepper('size', 'Size', smaller, larger)
    smaller.addEventListener('click', () => context.choose({ size: stepSize(context.settings().size, -1) }))
    larger.addEventListener('click', () => context.choose({ size: stepSize(context.settings().size, 1) }))
    const box = element('div', { class: 'steppers' })
    box.append(size.row)
    const spacings = SPACINGS.map(([setting, name, range, read]) => {
        const down = stepButton(`Less ${name.toLowerCase()}`, ICONS.down)
        const up = stepButton(`More ${name.toLowerCase()}`, ICONS.up)
        const { row, value } = stepper(setting, name, down, up)
        down.addEventListener('click', () => context.choose({ [setting]: stepIn(range, context.settings()[setting], -1) }))
        up.addEventListener('click', () => context.choose({ [setting]: stepIn(range, context.settings()[setting], 1) }))
        box.append(row)
        return { setting, range, read, down, value, up }
    })
    return {
        box,
        fill() {
            const settings = context.settings()
            const fixed = context.fixedLayout
            const own = settings.bookLayout
            size.value.textContent = String(settings.size)
            smaller.disabled = fixed || settings.size <= SIZE.min
            larger.disabled = fixed || settings.size >= SIZE.max
            for (const { setting, range, read, down, value, up } of spacings) {
                value.textContent = read(settings[setting])
                down.disabled = fixed || own || settings[setting] <= range.min
                up.disabled = fixed || own || settings[setting] >= range.max
            }
        },
    }
}
