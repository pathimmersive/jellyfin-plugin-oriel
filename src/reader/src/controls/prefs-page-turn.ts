import type { PageTurn } from '../settings/settings'
import { choiceGroup, element } from './elements'
import { icon, ICONS } from './icons'
import type { PrefsContext, PrefsSection } from './prefs-section'

// The page turns: the setting, its name and its icon, as the canvas draws them.
const PAGE_TURN_CHOICES: [PageTurn, string, keyof typeof ICONS][] = [
    ['slide', 'Slide', 'slide'],
    ['scroll', 'Scroll', 'scroll'],
    ['fade', 'Fade', 'fade'],
    ['none', 'None', 'none'],
]

/** Page turn: how pages turn. */
export const createPageTurns = (context: PrefsContext): PrefsSection => {
    const pageTurns = choiceGroup('Page turn')
    const buttons = PAGE_TURN_CHOICES.map(([setting, name, path]) => {
        const button = element('button', { type: 'button', class: 'page-turn', 'aria-pressed': 'false' }, `${icon(ICONS[path])}<span></span>`)
        button.querySelector('span')!.textContent = name
        button.disabled = context.fixedLayout
        button.addEventListener('click', () => context.choose({ pageTurn: setting }))
        pageTurns.row.append(button)
        return { setting, button }
    })
    return {
        box: pageTurns.box,
        fill() {
            for (const { setting, button } of buttons) button.setAttribute('aria-pressed', String(context.settings().pageTurn === setting))
        },
    }
}
