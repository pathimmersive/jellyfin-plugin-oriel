import { describe, expect, it } from 'vitest'
import { isScriptUrl } from '../src/engine/scripts'

describe('isScriptUrl', () => {
    it('knows a javascript: URL however it is written', () => {
        expect(isScriptUrl('javascript:alert(1)')).toBe(true)
        expect(isScriptUrl('  JavaScript:alert(1)')).toBe(true)
        expect(isScriptUrl('java\tscript:alert(1)')).toBe(true)
        expect(isScriptUrl('\u0001javascript:void 0')).toBe(true)
    })

    it('leaves every other link alone', () => {
        expect(isScriptUrl('chapter2.xhtml#note')).toBe(false)
        expect(isScriptUrl('blob:http://localhost/0a1b')).toBe(false)
        expect(isScriptUrl('https://example.org/javascript:')).toBe(false)
        expect(isScriptUrl('')).toBe(false)
    })
})
