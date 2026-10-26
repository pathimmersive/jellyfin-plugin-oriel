import { describe, expect, it } from 'vitest'
import { guardSelectionDrag } from '../src/engine/selection'

// A section document whose window is a plain EventTarget; stopPropagation
// shows up as cancelBubble on the dispatched event.
const section = (selection: { isCollapsed: boolean, rangeCount: number } | null) => {
    const window = new EventTarget()
    guardSelectionDrag({ defaultView: window as unknown as Window, getSelection: () => selection })
    return (type = 'touchmove') => {
        const event = new Event(type, { cancelable: true })
        window.dispatchEvent(event)
        return event
    }
}

describe('guardSelectionDrag', () => {
    it('stops a drag from reaching the paginator while text is selected, without cancelling it', () => {
        const event = section({ isCollapsed: false, rangeCount: 1 })()
        expect(event.cancelBubble).toBe(true)
        expect(event.defaultPrevented).toBe(false)
    })

    it('lets a swipe through when nothing is selected', () => {
        expect(section({ isCollapsed: true, rangeCount: 1 })().cancelBubble).toBe(false)
        expect(section({ isCollapsed: true, rangeCount: 0 })().cancelBubble).toBe(false)
        expect(section(null)().cancelBubble).toBe(false)
    })

    it('only handles touchmove', () => {
        expect(section({ isCollapsed: false, rangeCount: 1 })('touchstart').cancelBubble).toBe(false)
    })

    it('does nothing for a document without a window', () => {
        expect(() => guardSelectionDrag({ defaultView: null, getSelection: () => null })).not.toThrow()
    })
})
