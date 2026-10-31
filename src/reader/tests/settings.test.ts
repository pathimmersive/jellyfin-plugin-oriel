import { describe, expect, it } from 'vitest'
import { bookStyles, DEFAULTS, readSettings, stepSize, writeSettings } from '../src/settings/settings'

const store = (value: string | null): { getItem: () => string | null } => ({ getItem: () => value })

describe('readSettings', () => {
    it('gives the defaults when nothing is kept: Light, the book\'s own font, 18', () => {
        expect(readSettings(store(null))).toEqual({ theme: 'light', font: 'Default', size: 18 })
        expect(DEFAULTS).toEqual({ theme: 'light', font: 'Default', size: 18 })
    })

    it('reads what was kept', () => {
        expect(readSettings(store('{"theme":"sepia","font":"Literata","size":24}'))).toEqual({ theme: 'sepia', font: 'Literata', size: 24 })
    })

    it('falls back to the default for each value that is unknown or out of range', () => {
        expect(readSettings(store('{"theme":"neon","font":"Comic Sans","size":99}'))).toEqual(DEFAULTS)
        expect(readSettings(store('{"theme":"dark","size":11}'))).toEqual({ theme: 'dark', font: 'Default', size: 18 })
        expect(readSettings(store('{"size":"20"}'))).toEqual(DEFAULTS)
        expect(readSettings(store('{"theme":"toString"}'))).toEqual(DEFAULTS)
    })

    it('gives the defaults for storage it cannot read', () => {
        expect(readSettings(store('not json'))).toEqual(DEFAULTS)
        expect(readSettings(store('42'))).toEqual(DEFAULTS)
    })
})

describe('writeSettings', () => {
    it('keeps the settings so readSettings gives them back', () => {
        let kept: string | null = null
        writeSettings({ setItem: (_key, value) => { kept = value } }, { theme: 'dark', font: 'Noto Sans', size: 20 })
        expect(readSettings(store(kept))).toEqual({ theme: 'dark', font: 'Noto Sans', size: 20 })
    })

    it('does not throw when the browser refuses storage', () => {
        expect(() => writeSettings({ setItem: () => { throw new Error('QuotaExceededError') } }, DEFAULTS)).not.toThrow()
    })
})

describe('stepSize', () => {
    it('steps by 1 within 12 to 32', () => {
        expect(stepSize(18, 1)).toBe(19)
        expect(stepSize(18, -1)).toBe(17)
        expect(stepSize(32, 1)).toBe(32)
        expect(stepSize(12, -1)).toBe(12)
    })
})

describe('bookStyles', () => {
    it('sets the theme colours over the book\'s own, keeping links, and the size on the root', () => {
        const css = bookStyles({ theme: 'sepia', font: 'Default', size: 22 }, '@font-face {}')
        expect(css).toContain('@font-face {}')
        expect(css).toContain('color: #3b2f22 !important; background: #f4ecd8 !important')
        expect(css).toContain('font-size: 22px !important')
        expect(css).toContain('body *:not(a) { color: inherit !important')
    })

    it('leaves the book\'s own font for Default and sets a chosen one except on code', () => {
        expect(bookStyles(DEFAULTS, '')).not.toContain('font-family')
        const css = bookStyles({ ...DEFAULTS, font: 'Atkinson Hyperlegible' }, '')
        expect(css).toContain("body, body *:not(code):not(pre):not(kbd):not(samp) { font-family: 'Atkinson Hyperlegible', system-ui, sans-serif !important; }")
    })

    it('asks for dark form controls and scrollbars in the Dark theme', () => {
        expect(bookStyles({ ...DEFAULTS, theme: 'dark' }, '')).toContain('color-scheme: dark')
        expect(bookStyles(DEFAULTS, '')).toContain('color-scheme: light')
    })
})
