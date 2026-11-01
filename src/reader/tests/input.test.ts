import { describe, expect, it } from 'vitest'
import { attachPageInput, clickTarget, type Edges, keyTurn, scrollTarget, type Turn, wheelGesture } from '../src/engine/input'

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

describe('clickTarget', () => {
    // A page 1000 wide starting at 100: with a mouse, edges up to 320 and from 880.
    it('turns left in the left 22% and right in the right 22% with a mouse', () => {
        expect(clickTarget(100, 100, 1000, false)).toBe('left')
        expect(clickTarget(319, 100, 1000, false)).toBe('left')
        expect(clickTarget(881, 100, 1000, false)).toBe('right')
        expect(clickTarget(1100, 100, 1000, false)).toBe('right')
    })

    it('asks for the controls in the middle 56% with a mouse', () => {
        expect(clickTarget(321, 100, 1000, false)).toBe('menu')
        expect(clickTarget(600, 100, 1000, false)).toBe('menu')
        expect(clickTarget(879, 100, 1000, false)).toBe('menu')
    })

    // With touch, edges up to 400 and from 800.
    it('turns in the outer 30% and asks for the controls in the middle 40% with touch', () => {
        expect(clickTarget(399, 100, 1000, true)).toBe('left')
        expect(clickTarget(801, 100, 1000, true)).toBe('right')
        expect(clickTarget(401, 100, 1000, true)).toBe('menu')
        expect(clickTarget(799, 100, 1000, true)).toBe('menu')
    })

    it('does nothing outside the page or on a page with no width', () => {
        expect(clickTarget(50, 100, 1000, false)).toBeNull()
        expect(clickTarget(1200, 100, 1000, true)).toBeNull()
        expect(clickTarget(100, 100, 0, false)).toBeNull()
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

// A document whose window is a plain EventTarget, with events built by hand;
// with `edges`, in Scroll mode, at those edges of its section.
const page = (selected = false, edges: Edges | null = null) => {
    const window = new EventTarget()
    const turns: Turn[] = []
    let menus = 0
    let swipes = 0
    const time = clock()
    attachPageInput(
        { defaultView: window as unknown as Window, getSelection: () => ({ isCollapsed: !selected }) },
        () => ({ left: 0, width: 1000, top: 0, height: 600 }),
        wheelGesture(time.now),
        turn => turns.push(turn),
        () => { menus++ },
        () => { swipes++ },
        { active: () => edges !== null, edges: () => edges ?? { start: false, end: false } },
    )
    const fire = (type: string, fields: Record<string, unknown>) => {
        const event = new Event(type, { cancelable: true })
        for (const [name, value] of Object.entries(fields)) Object.defineProperty(event, name, { value })
        window.dispatchEvent(event)
        return event
    }
    const click = (x: number, fields: Record<string, unknown> = {}, downX = x, pointerType = 'mouse', y = 300) => {
        fire('pointerdown', { button: 0, clientX: downX, clientY: y, pointerType })
        return fire('click', { button: 0, clientX: x, clientY: y, target: null, ...fields })
    }
    // A finger down at `x`, `y`, then up at `upX`, `upY` after `ms`.
    const tap = (x: number, { upX = x, ms = 80, target = null as unknown, y = 300, upY = y }: { upX?: number, ms?: number, target?: unknown, y?: number, upY?: number } = {}) => {
        fire('touchstart', { touches: [{ clientX: x, clientY: y }], timeStamp: 1000 })
        return fire('touchend', { touches: [], changedTouches: [{ clientX: upX, clientY: upY }], timeStamp: 1000 + ms, target })
    }
    return { turns, menus: () => menus, swipes: () => swipes, fire, click, tap, time }
}

describe('attachPageInput', () => {
    it('turns on a handled key and cancels it, so the browser does not scroll', () => {
        const { turns, fire } = page()
        const event = fire('keydown', key(' '))
        expect(turns).toEqual(['next'])
        expect(event.defaultPrevented).toBe(true)
    })

    it('leaves Space and Enter on a button or link to press it', () => {
        const { turns, fire } = page()
        const button = { closest: (selector: string) => selector.includes('button') ? {} : null }
        fire('keydown', { ...key(' '), target: button })
        fire('keydown', { ...key('Enter'), target: button })
        fire('keydown', { ...key('ArrowRight'), target: button })
        expect(turns).toEqual(['right'])
    })

    it('leaves other keys, and keys typed into a field, alone', () => {
        const { turns, fire } = page()
        expect(fire('keydown', key('a')).defaultPrevented).toBe(false)
        fire('keydown', { ...key('ArrowRight'), target: { tagName: 'INPUT' } })
        fire('keydown', { ...key('ArrowRight'), target: { isContentEditable: true } })
        expect(turns).toEqual([])
    })

    it('turns on a click on an edge and asks for the controls on a click in the middle', () => {
        const { turns, menus, click } = page()
        click(950)
        click(50)
        click(500)
        expect(turns).toEqual(['right', 'left'])
        expect(menus()).toBe(1)
    })

    it('reads a tap from touch events, with the wider touch edges', () => {
        const { turns, menus, tap, click } = page()
        tap(250)
        tap(500)
        expect(turns).toEqual(['left'])
        expect(menus()).toBe(1)
        // The click a tap ends in is not counted again.
        click(250, {}, 250, 'touch')
        expect(turns).toEqual(['left'])
        expect(menus()).toBe(1)
    })

    it('does not take a swipe, a long press, a second finger or a tap on a control for a tap', () => {
        const { turns, menus, swipes, tap, fire } = page()
        tap(500, { upX: 560 })
        tap(500, { ms: 900 })
        tap(500, { target: { closest: (selector: string) => selector.includes('button') ? {} : null } })
        fire('touchstart', { touches: [{ clientX: 500, clientY: 300 }, { clientX: 600, clientY: 300 }], timeStamp: 0 })
        fire('touchend', { touches: [], changedTouches: [{ clientX: 500, clientY: 300 }], timeStamp: 50, target: null })
        expect(turns).toEqual([])
        expect(menus()).toBe(0)
        expect(swipes()).toBe(1)
    })

    it('does not report a drag that selects text as a swipe', () => {
        const { swipes, tap } = page(true)
        tap(500, { upX: 560 })
        expect(swipes()).toBe(0)
    })

    it('leaves clicks on the controls themselves alone', () => {
        const { turns, menus, click } = page()
        const control = { closest: (selector: string) => selector.includes('button') ? {} : null }
        click(500, { target: control })
        click(950, { target: control })
        expect(turns).toEqual([])
        expect(menus()).toBe(0)
    })

    it('does not turn on a click on a link, after a drag, or with text selected', () => {
        const link = page()
        link.click(950, { target: { closest: (selector: string) => selector.includes('a[href]') ? {} : null } })
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
        expect(() => attachPageInput({ defaultView: null, getSelection: () => null }, () => null, wheelGesture(), () => {}, () => {})).not.toThrow()
    })
})

describe('scrollTarget', () => {
    it('scrolls up on the top 30% of the page, down on the bottom 30%, and shows the controls between', () => {
        expect(scrollTarget(50, 0, 600)).toBe('prev')
        expect(scrollTarget(560, 0, 600)).toBe('next')
        expect(scrollTarget(300, 0, 600)).toBe('menu')
        expect(scrollTarget(700, 0, 600)).toBeNull()
        expect(scrollTarget(10, 0, 0)).toBeNull()
    })
})

describe('Scroll mode', () => {
    it('scrolls a screen with the up and down arrows, which are left alone when paged', () => {
        expect(keyTurn(key('ArrowDown'), true)).toBe('next')
        expect(keyTurn(key('ArrowUp'), true)).toBe('prev')
        expect(keyTurn(key('ArrowDown'))).toBeNull()
        expect(keyTurn(key('ArrowUp', { shiftKey: true }), true)).toBeNull()
    })

    it('acts on a click or tap by its height', () => {
        const { turns, menus, click, tap } = page(false, { start: false, end: false })
        click(500, {}, 500, 'mouse', 560)
        click(500, {}, 500, 'mouse', 40)
        tap(50, { y: 300 })
        expect(turns).toEqual(['next', 'prev'])
        expect(menus()).toBe(1)
    })

    it('leaves the wheel to the browser, and goes on past the end of the section', () => {
        const middle = page(false, { start: false, end: false })
        const wheel = middle.fire('wheel', { deltaX: 0, deltaY: 120, deltaMode: 0 })
        expect(wheel.defaultPrevented).toBe(false)
        expect(middle.turns).toEqual([])
        const end = page(false, { start: false, end: true })
        end.fire('wheel', { deltaX: 0, deltaY: 120, deltaMode: 0 })
        end.fire('wheel', { deltaX: 0, deltaY: -120, deltaMode: 0 })
        expect(end.turns).toEqual(['next'])
    })

    it('goes on to the next section on a drag up from its end, and back on a drag down from its start', () => {
        const end = page(false, { start: false, end: true })
        end.tap(500, { y: 400, upY: 200 })
        expect(end.turns).toEqual(['next'])
        const start = page(false, { start: true, end: false })
        start.tap(500, { y: 200, upY: 400 })
        expect(start.turns).toEqual(['prev'])
        const middle = page(false, { start: false, end: false })
        middle.tap(500, { y: 400, upY: 200 })
        expect(middle.turns).toEqual([])
    })
})
