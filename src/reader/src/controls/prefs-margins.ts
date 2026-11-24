import { MARGIN, marginsFor, SIDES, stepIn } from '../settings/settings'
import { element, stepButton, stepper } from './elements'
import { ICONS } from './icons'
import type { PrefsContext, PrefsSection } from './prefs-section'

/** Margins, in px: the screen's defaults until one is changed. */
export const createMargins = (context: PrefsContext): PrefsSection => {
    const box = element('div', { role: 'group', 'aria-label': 'Margins in pixels', class: 'margins' }, '<span class="group-label">Margins (px)</span>')
    const grid = element('div', { class: 'margin-grid' })
    box.append(grid)
    const steppers = SIDES.map(side => {
        const name = side[0].toUpperCase() + side.slice(1)
        const down = stepButton(`Less ${side} margin`, ICONS.down)
        const up = stepButton(`More ${side} margin`, ICONS.up)
        const { row, value } = stepper(`margin-${side}`, name, down, up, 'margin')
        const move = (step: -1 | 1): void => {
            const shown = marginsFor(context.settings(), context.wide())
            context.choose({ margins: { ...shown, [side]: stepIn(MARGIN, shown[side], step) } })
        }
        down.addEventListener('click', () => move(-1))
        up.addEventListener('click', () => move(1))
        grid.append(row)
        return { side, down, value, up }
    })
    return {
        box,
        fill() {
            const shown = marginsFor(context.settings(), context.wide())
            for (const { side, down, value, up } of steppers) {
                value.textContent = String(shown[side])
                down.disabled = context.fixedLayout || shown[side] <= MARGIN.min
                up.disabled = context.fixedLayout || shown[side] >= MARGIN.max
            }
        },
    }
}
