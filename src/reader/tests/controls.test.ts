import { describe, expect, it } from 'vitest'
import { HIDDEN, nextControls } from '../src/controls/state'

describe('nextControls', () => {
    it('shows the controls on a tap in the middle and hides them on the next', () => {
        const shown = nextControls(HIDDEN, 'middle')
        expect(shown).toEqual({ shown: true, more: false })
        expect(nextControls(shown, 'middle')).toEqual(HIDDEN)
    })

    it('hides the controls, and More, when the reader turns a page', () => {
        expect(nextControls({ shown: true, more: true }, 'turned')).toEqual(HIDDEN)
        expect(nextControls(HIDDEN, 'turned')).toEqual(HIDDEN)
    })

    it('opens and closes More with its button, keeping the controls shown', () => {
        const open = nextControls({ shown: true, more: false }, 'more')
        expect(open).toEqual({ shown: true, more: true })
        expect(nextControls(open, 'more')).toEqual({ shown: true, more: false })
    })

    it('closes only More on a tap outside it or in the middle', () => {
        expect(nextControls({ shown: true, more: true }, 'outside')).toEqual({ shown: true, more: false })
        expect(nextControls({ shown: true, more: true }, 'middle')).toEqual({ shown: true, more: false })
    })
})
