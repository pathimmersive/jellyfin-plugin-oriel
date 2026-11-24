import { describe, expect, it } from 'vitest'
import { closeOnEscape } from '../src/controls/escape'

// What Escape can close, with the ones named open.
const targets = (...open: string[]) => {
    const closed: string[] = []
    const target = (name: string) => ({ get shown() { return open.includes(name) }, close: () => { closed.push(name) } })
    return {
        closed,
        targets: {
            hint: target('hint'),
            reset: target('reset'),
            highlighter: target('highlighter'),
            theme: () => {
                if (!open.includes('theme')) return false
                closed.push('theme')
                return true
            },
            panels: target('panels'),
        },
    }
}

const press = (key: string, ...open: string[]): { closed: string[], prevented: boolean } => {
    const { closed, targets: all } = targets(...open)
    let prevented = false
    closeOnEscape(all)({ key, preventDefault: () => { prevented = true } })
    return { closed, prevented }
}

describe('closeOnEscape', () => {
    it('closes only what is over everything else: the hint, then the dialogs, then the panel', () => {
        const order = ['hint', 'reset', 'highlighter', 'theme', 'panels']
        for (let first = 0; first < order.length; first++) {
            expect(press('Escape', ...order.slice(first)).closed).toEqual([order[first]])
        }
    })

    it('closes each when it alone is open', () => {
        for (const name of ['hint', 'reset', 'highlighter', 'theme', 'panels']) expect(press('Escape', name).closed).toEqual([name])
    })

    it('keeps the browser from clearing the search field only when it closes a panel', () => {
        expect(press('Escape', 'panels').prevented).toBe(true)
        for (const name of ['hint', 'reset', 'highlighter', 'theme']) expect(press('Escape', name, 'panels').prevented).toBe(false)
    })

    it('does nothing with nothing open, and for any other key', () => {
        expect(press('Escape')).toEqual({ closed: [], prevented: false })
        expect(press('Enter', 'hint', 'reset', 'highlighter', 'theme', 'panels')).toEqual({ closed: [], prevented: false })
    })
})
