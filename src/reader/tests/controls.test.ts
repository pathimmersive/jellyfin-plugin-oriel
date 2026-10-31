import { describe, expect, it } from 'vitest'
import { HIDDEN, nextControls } from '../src/controls/state'

describe('nextControls', () => {
    it('shows the controls on a tap in the middle and hides them on the next', () => {
        const shown = nextControls(HIDDEN, 'middle')
        expect(shown).toEqual({ shown: true, more: false, contents: false, prefs: false })
        expect(nextControls(shown, 'middle')).toEqual(HIDDEN)
    })

    it('hides the controls, and More, when the reader turns a page', () => {
        expect(nextControls({ shown: true, more: true, contents: false, prefs: false }, 'turned')).toEqual(HIDDEN)
        expect(nextControls(HIDDEN, 'turned')).toEqual(HIDDEN)
    })

    it('opens and closes More with its button, keeping the controls shown', () => {
        const open = nextControls({ shown: true, more: false, contents: false, prefs: false }, 'more')
        expect(open).toEqual({ shown: true, more: true, contents: false, prefs: false })
        expect(nextControls(open, 'more')).toEqual({ shown: true, more: false, contents: false, prefs: false })
    })

    it('closes only More on a tap outside it or in the middle', () => {
        expect(nextControls({ shown: true, more: true, contents: false, prefs: false }, 'outside')).toEqual({ shown: true, more: false, contents: false, prefs: false })
        expect(nextControls({ shown: true, more: true, contents: false, prefs: false }, 'middle')).toEqual({ shown: true, more: false, contents: false, prefs: false })
    })

    it('opens Contents over the controls, closing More, and closes it without hiding them', () => {
        const open = nextControls({ shown: true, more: true, contents: false, prefs: false }, 'contents')
        expect(open).toEqual({ shown: true, more: false, contents: true, prefs: false })
        expect(nextControls(open, 'outside')).toEqual({ shown: true, more: false, contents: false, prefs: false })
        expect(nextControls(open, 'middle')).toEqual({ shown: true, more: false, contents: false, prefs: false })
        expect(nextControls(open, 'more')).toEqual({ shown: true, more: true, contents: false, prefs: false })
    })

    it('opens Preferences over the controls, closing Contents or More, and closes it without hiding them', () => {
        const open = nextControls({ shown: true, more: false, contents: true, prefs: false }, 'prefs')
        expect(open).toEqual({ shown: true, more: false, contents: false, prefs: true })
        expect(nextControls(open, 'outside')).toEqual({ shown: true, more: false, contents: false, prefs: false })
        expect(nextControls(open, 'middle')).toEqual({ shown: true, more: false, contents: false, prefs: false })
        expect(nextControls(open, 'prefs')).toEqual({ shown: true, more: false, contents: false, prefs: false })
        expect(nextControls(open, 'contents')).toEqual({ shown: true, more: false, contents: true, prefs: false })
        expect(nextControls(open, 'turned')).toEqual(HIDDEN)
    })

    it('hides everything once an entry in Contents is chosen', () => {
        expect(nextControls({ shown: true, more: false, contents: true, prefs: false }, 'chosen')).toEqual(HIDDEN)
    })
})
