import { describe, expect, it } from 'vitest'
import { attachPageInput, clickTurn, keyTurn, type Turn, wheelGesture } from '../src/engine/input'

const key = (key: string, mods: Partial<{ shiftKey: boolean, ctrlKey: boolean, altKey: boolean, metaKey: boolean }> = {}) =>
    ({ key, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...mods })

describe('keyTurn', () => {
    it('turns right and left with the arrow keys', () => {
        expect(keyTurn(key('ArrowRight'))).toBe('right')
        expect(keyTurn(key('ArrowLeft'))).toBe('left')
    })

    it('turns to the next page with Space and Page Down, and back with Shift+Space and Page Up', () => {
        expect(keyTurn(key(' '))).toBe('next')
        expect(keyTurn(key('PageDown'))).toBe('next')
        expect(keyTurn(key(' ', { shiftKey: true }))).toBe('prev')
        expect(keyTurn(key('PageUp'))).toBe('prev')
    })

    it('leaves browser shortcuts and keyboard selection to the browser', () => {
        for (const mod of ['ctrlKey', 'altKey', 'metaKey'] as const) {
            expect(keyTurn(key('ArrowRight', { [mod]: true }))).toBeNull()
            expect(keyTurn(key(' ', { [mod]: true }))).toBeNull()
        }
        expect(keyTurn(key('ArrowRight', { shiftKey: true }))).toBeNull()
        expect(keyTurn(key('ArrowLeft', { shiftKey: true }))).toBeNull()
    })

    it('ignores other keys', () => {
        expect(keyTurn(key('a'))).toBeNull()
        expect(keyTurn(key('ArrowDown'))).toBeNull()
        expect(keyTurn(key('Enter'))).toBeNull()
    })
})

describe('clickTurn', () => {
    // A page 1000 wide starting at 100: edges up to 320 and from 880.
    it('turns left in the left 22% and right in the right 22%', () => {
        expect(clickTurn(100, 100, 1000)).toBe('left')
        expect(clickTurn(319, 100, 1000)).toBe('left')
        expect(clickTurn(881, 100, 1000)).toBe('right')
        expect(clickTurn(1100, 100, 1000)).toBe('right')
    })

    it('turns nothing in the middle 56%', () => {
        expect(clickTurn(321, 100, 1000)).toBeNull()
        expect(clickTurn(600, 100, 1000)).toBeNull()
        expect(clickTurn(879, 100, 1000)).toBeNull()
    })

    it('turns nothing outside the page or on a page with no width', () => {
        expect(clickTurn(50, 100, 1000)).toBeNull()
        expect(clickTurn(1200, 100, 1000)).toBeNull()
        expect(clickTurn(100, 100, 0)).toBeNull()
    })
})

// A clock the test moves by hand.
const clock = () => {
    let time = 0
    return { now: () => time, advance: (ms: number) => { time += ms } }
}

describe('wheelGesture', () => {
    const wheel = (deltaX: number, deltaY: number, deltaMode = 0) => ({ deltaX, deltaY, deltaMode })

    it('turns to the next or previous page on one wheel notch down or up', () => {
        const time = clock()
        const gesture = wheelGesture(time.now)
        expect(gesture(wheel(0, 100))).toBe('next')
        time.advance(400)
        expect(gesture(wheel(0, -100))).toBe('prev')
    })

    it('turns right or left on a sideways swipe', () => {
        const time = clock()
        const gesture = wheelGesture(time.now)
        expect(gesture(wheel(60, 5))).toBe('right')
        time.advance(400)
        expect(gesture(wheel(-60, -5))).toBe('left')
    })

    it('turns once per gesture, momentum included, until a pause over 250 ms', () => {
        const time = clock()
        const gesture = wheelGesture(time.now)
        const turns: (Turn | null)[] = []
        for (const delta of [4, 8, 14, 20, 24, 24, 20, 16, 12, 9, 6, 4, 3, 2, 1, 1]) {
            turns.push(gesture(wheel(delta, 0)))
            time.advance(16)
        }
        expect(turns.filter(Boolean)).toEqual(['right'])
        time.advance(200)
        expect(gesture(wheel(40, 0))).toBeNull()
        time.advance(260)
        expect(gesture(wheel(40, 0))).toBe('right')
    })

    it('waits until the gesture has moved 24 pixels', () => {
        const time = clock()
        const gesture = wheelGesture(time.now)
        expect(gesture(wheel(0, 10))).toBeNull()
        time.advance(16)
        expect(gesture(wheel(0, 10))).toBeNull()
        time.advance(16)
        expect(gesture(wheel(0, 10))).toBe('next')
    })

    it('counts line and page deltas in pixels', () => {
        const time = clock()
        const gesture = wheelGesture(time.now)
        expect(gesture(wheel(0, 3, 1))).toBe('next')
        time.advance(400)
        expect(gesture(wheel(0, -1, 2))).toBe('prev')
    })
})

// A document whose window is a plain EventTarget, with events built by hand.
const page = (selected = false) => {
    const window = new EventTarget()
    const turns: Turn[] = []
    const time = clock()
    attachPageInput(
        { defaultView: window as unknown as Window, getSelection: () => ({ isCollapsed: !selected }) },
        () => ({ left: 0, width: 1000 }),
        wheelGesture(time.now),
        turn => turns.push(turn),
    )
    const fire = (type: string, fields: Record<string, unknown>) => {
        const event = new Event(type, { cancelable: true })
        for (const [name, value] of Object.entries(fields)) Object.defineProperty(event, name, { value })
        window.dispatchEvent(event)
        return event
    }
    const click = (x: number, fields: Record<string, unknown> = {}, downX = x) => {
        fire('pointerdown', { button: 0, clientX: downX, clientY: 300 })
        return fire('click', { button: 0, clientX: x, clientY: 300, target: null, ...fields })
    }
    return { turns, fire, click, time }
}

describe('attachPageInput', () => {
    it('turns on a handled key and cancels it, so the browser does not scroll', () => {
        const { turns, fire } = page()
        const event = fire('keydown', key(' '))
        expect(turns).toEqual(['next'])
        expect(event.defaultPrevented).toBe(true)
    })

    it('leaves other keys, and keys typed into a field, alone', () => {
        const { turns, fire } = page()
        expect(fire('keydown', key('a')).defaultPrevented).toBe(false)
        fire('keydown', { ...key('ArrowRight'), target: { tagName: 'INPUT' } })
        fire('keydown', { ...key('ArrowRight'), target: { isContentEditable: true } })
        expect(turns).toEqual([])
    })

    it('turns on a click on an edge but not in the middle', () => {
        const { turns, click } = page()
        click(950)
        click(50)
        click(500)
        expect(turns).toEqual(['right', 'left'])
    })

    it('does not turn on a click on a link, after a drag, or with text selected', () => {
        const link = page()
        link.click(950, { target: { closest: (selector: string) => selector === 'a[href]' ? {} : null } })
        link.click(950, {}, 600)
        expect(link.turns).toEqual([])
        const selected = page(true)
        selected.click(950)
        expect(selected.turns).toEqual([])
    })

    it('does not turn on a middle or right click', () => {
        const { turns, fire } = page()
        fire('pointerdown', { button: 1, clientX: 950, clientY: 300 })
        fire('click', { button: 1, clientX: 950, clientY: 300, target: null })
        expect(turns).toEqual([])
    })

    it('turns once per wheel gesture, cancels the wheel, and leaves Ctrl+wheel zoom alone', () => {
        const { turns, fire, time } = page()
        const first = fire('wheel', { deltaX: 0, deltaY: 100, deltaMode: 0, ctrlKey: false })
        time.advance(16)
        fire('wheel', { deltaX: 0, deltaY: 100, deltaMode: 0, ctrlKey: false })
        expect(turns).toEqual(['next'])
        expect(first.defaultPrevented).toBe(true)
        time.advance(400)
        const zoom = fire('wheel', { deltaX: 0, deltaY: 100, deltaMode: 0, ctrlKey: true })
        expect(turns).toEqual(['next'])
        expect(zoom.defaultPrevented).toBe(false)
    })

    it('does nothing for a document without a window', () => {
        expect(() => attachPageInput({ defaultView: null, getSelection: () => null }, () => null, wheelGesture(), () => {})).not.toThrow()
    })
})
