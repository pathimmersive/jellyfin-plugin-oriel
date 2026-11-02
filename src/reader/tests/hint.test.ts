import { describe, expect, it } from 'vitest'
import { hintDue, hintKind, hintLine, lastInput, readHintsSeen, sawHint } from '../src/controls/hint'

const memory = (): { getItem: (key: string) => string | null, setItem: (key: string, value: string) => void } => {
    const kept = new Map<string, string>()
    return { getItem: key => kept.get(key) ?? null, setItem: (key, value) => { kept.set(key, value) } }
}

describe('hintKind', () => {
    it('shows the tap zones on a touch screen, the dialog on a desktop, and the Scroll zones in Scroll mode', () => {
        expect(hintKind('slide', true)).toBe('touch')
        expect(hintKind('fade', false)).toBe('desktop')
        expect(hintKind('scroll', true)).toBe('scroll')
        expect(hintKind('scroll', false)).toBe('scroll')
    })
})

describe('hintLine', () => {
    it('says how to swipe, drag or scroll with the mouse', () => {
        expect(hintLine('touch', true)).toBe('Or swipe left and right to turn pages.')
        expect(hintLine('scroll', true)).toBe('Or drag up and down to scroll freely.')
        expect(hintLine('scroll', false)).toBe('Or use the mouse wheel or arrow keys to scroll freely.')
    })
})

describe('when the hint shows by itself', () => {
    it('shows on the first open and on the first Scroll, and not after Got it', () => {
        const storage = memory()
        expect(hintDue(readHintsSeen(storage), 'open')).toBe(true)
        sawHint(storage, 'touch')
        expect(hintDue(readHintsSeen(storage), 'open')).toBe(false)
        expect(hintDue(readHintsSeen(storage), 'scroll')).toBe(true)
        sawHint(storage, 'scroll')
        expect(hintDue(readHintsSeen(storage), 'scroll')).toBe(false)
    })

    it('counts a Scroll hint seen on the first open as both', () => {
        const storage = memory()
        sawHint(storage, 'scroll')
        expect(readHintsSeen(storage)).toEqual({ first: true, scroll: true })
    })

    it('counts storage it cannot read as nothing seen, and does not throw when storage is refused', () => {
        expect(readHintsSeen({ getItem: () => 'not json' })).toEqual({ first: false, scroll: false })
        expect(readHintsSeen({ getItem: () => '{"first":"yes"}' })).toEqual({ first: false, scroll: false })
        expect(() => sawHint({ getItem: () => null, setItem: () => { throw new Error('QuotaExceededError') } }, 'touch')).not.toThrow()
    })
})

describe('lastInput', () => {
    // A window that records its listeners, and sends one event to them.
    const fakeWindow = () => {
        const listeners = new Map<string, ((event: unknown) => void)[]>()
        return {
            addEventListener: (type: string, listener: (event: unknown) => void) => {
                listeners.set(type, [...listeners.get(type) ?? [], listener])
            },
            send: (type: string, event: object = {}) => listeners.get(type)?.forEach(listener => listener(event)),
        }
    }

    it('follows the primary pointer until the reader uses one', () => {
        let coarse = true
        const input = lastInput(() => coarse)
        input.watch(fakeWindow() as unknown as Window)
        expect(input.touch()).toBe(true)
        coarse = false
        expect(input.touch()).toBe(false)
    })

    it('follows a touch, then a mouse, a key or the wheel, in any watched window', () => {
        const input = lastInput(() => false)
        const page = fakeWindow()
        const section = fakeWindow()
        input.watch(page as unknown as Window)
        input.watch(section as unknown as Window)
        section.send('pointerdown', { pointerType: 'touch' })
        expect(input.touch()).toBe(true)
        page.send('pointerdown', { pointerType: 'mouse' })
        expect(input.touch()).toBe(false)
        section.send('touchstart')
        expect(input.touch()).toBe(true)
        page.send('keydown')
        expect(input.touch()).toBe(false)
        section.send('touchstart')
        section.send('wheel')
        expect(input.touch()).toBe(false)
    })

    it('leaves the last input as it was for a pen', () => {
        const input = lastInput(() => false)
        const page = fakeWindow()
        input.watch(page as unknown as Window)
        page.send('touchstart')
        page.send('pointerdown', { pointerType: 'pen' })
        expect(input.touch()).toBe(true)
    })
})
