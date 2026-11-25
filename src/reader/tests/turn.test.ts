import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { turnPage } from '../src/engine/turn'

// A rejection nobody handles fails the test that is running, as it would reach the page's own handler.
const unhandled: unknown[] = []
const onUnhandled = (reason: unknown): void => { unhandled.push(reason) }

describe('turnPage', () => {
    beforeEach(() => {
        unhandled.length = 0
        process.on('unhandledRejection', onUnhandled)
        vi.spyOn(console, 'error').mockImplementation(() => {})
    })
    afterEach(() => {
        process.off('unhandledRejection', onUnhandled)
        vi.restoreAllMocks()
    })
    const book = () => ({ style: { transition: '', opacity: '' } })
    const later = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

    it('leaves no rejection unhandled when the move fails during a fade, and shows the book again', async () => {
        const view = book()
        turnPage(view, () => Promise.reject(new Error('no page')), true)
        expect(view.style.opacity).toBe('0')
        await later(400)
        expect(unhandled).toEqual([])
        expect(view.style.opacity).toBe('1')
        expect(console.error).toHaveBeenCalledOnce()
    })

    it('leaves none unhandled without a fade either', async () => {
        const view = book()
        turnPage(view, () => Promise.reject(new Error('no page')), false)
        await later(20)
        expect(unhandled).toEqual([])
        expect(view.style.opacity).toBe('')
        expect(console.error).toHaveBeenCalledOnce()
    })

    it('fades out, moves, and fades back in', async () => {
        const view = book()
        const seen: string[] = []
        turnPage(view, async () => { seen.push(view.style.opacity) }, true)
        expect(seen).toEqual([])
        await later(400)
        expect(seen).toEqual(['0'])
        expect(view.style.opacity).toBe('1')
        expect(console.error).not.toHaveBeenCalled()
    })
})
