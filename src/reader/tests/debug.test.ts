import { describe, expect, it } from 'vitest'
import { debugRequested, frameStats } from '../src/debug/frames'

describe('frameStats', () => {
    it('counts frames over the long-frame threshold and keeps the worst', () => {
        expect(frameStats([0, 16, 33, 120, 136, 200])).toEqual({ longFrames: 2, worstFrame: 87 })
    })

    it('reports nothing for smooth frames', () => {
        expect(frameStats([0, 16.7, 33.4, 50.1])).toEqual({ longFrames: 0, worstFrame: 17 })
    })

    it('needs two timestamps to measure a frame', () => {
        expect(frameStats([])).toEqual({ longFrames: 0, worstFrame: 0 })
        expect(frameStats([5])).toEqual({ longFrames: 0, worstFrame: 0 })
    })
})

describe('debugRequested', () => {
    it.each([
        ['?id=a&debug=1', true],
        ['?debug', true],
        ['?id=a', false],
        ['?debug=0', false],
        ['?debug=false', false],
    ])('%s -> %s', (search, expected) => {
        expect(debugRequested(search)).toBe(expected)
    })
})
