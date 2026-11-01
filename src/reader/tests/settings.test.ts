import { describe, expect, it } from 'vitest'
import { bookStyles, DEFAULTS, INDENT, LINE_SPACING, MARGIN, marginsFor, PHONE_MARGINS, readSettings, resetLayout, type Settings, stepIn, stepSize, WIDE_MARGINS, writeSettings } from '../src/settings/settings'

const store = (value: string | null): { getItem: () => string | null } => ({ getItem: () => value })

const CHOSEN: Settings = {
    theme: 'dark',
    font: 'Noto Sans',
    size: 20,
    lineSpacing: 1.8,
    paragraphSpacing: 0.4,
    indent: 2,
    margins: { left: 32, right: 28, top: 0, bottom: 200 },
    justify: false,
    hyphenate: false,
    bookLayout: true,
    progress: 'pages',
}

describe('readSettings', () => {
    it('gives the defaults when nothing is kept: Light, the book\'s own font, 18, the canvas layout', () => {
        expect(readSettings(store(null))).toEqual(DEFAULTS)
        expect(DEFAULTS).toEqual({
            theme: 'light', font: 'Default', size: 18,
            lineSpacing: 1.5, paragraphSpacing: 0, indent: 1.4, margins: null,
            justify: true, hyphenate: true, bookLayout: false, progress: 'percent',
        })
    })

    it('reads what was kept', () => {
        expect(readSettings(store(JSON.stringify(CHOSEN)))).toEqual(CHOSEN)
    })

    it('reads settings kept before the layout settings existed, with the layout defaults', () => {
        expect(readSettings(store('{"theme":"sepia","font":"Literata","size":24}'))).toEqual({ ...DEFAULTS, theme: 'sepia', font: 'Literata', size: 24 })
    })

    it('falls back to the default for each value that is unknown, of the wrong type or out of range', () => {
        expect(readSettings(store('{"theme":"neon","font":"Comic Sans","size":99}'))).toEqual(DEFAULTS)
        expect(readSettings(store('{"theme":"dark","size":11}'))).toEqual({ ...DEFAULTS, theme: 'dark' })
        expect(readSettings(store('{"size":"20"}'))).toEqual(DEFAULTS)
        expect(readSettings(store('{"theme":"toString"}'))).toEqual(DEFAULTS)
        expect(readSettings(store('{"lineSpacing":0.9,"paragraphSpacing":2.1,"indent":-0.1}'))).toEqual(DEFAULTS)
        expect(readSettings(store('{"lineSpacing":1.55,"indent":"2"}'))).toEqual(DEFAULTS)
        expect(readSettings(store('{"justify":"yes","hyphenate":1,"bookLayout":null}'))).toEqual(DEFAULTS)
        expect(readSettings(store('{"progress":"chapters"}'))).toEqual(DEFAULTS)
    })

    it('keeps margins only when all four are whole numbers from 0 to 200', () => {
        const margins = (value: unknown): Settings['margins'] => readSettings(store(JSON.stringify({ margins: value }))).margins
        expect(margins({ left: 0, right: 200, top: 16, bottom: 8 })).toEqual({ left: 0, right: 200, top: 16, bottom: 8 })
        expect(margins({ left: 24, right: 24, top: 16 })).toBeNull()
        expect(margins({ left: 24, right: 24, top: 16, bottom: 204 })).toBeNull()
        expect(margins({ left: 24.5, right: 24, top: 16, bottom: 8 })).toBeNull()
        expect(margins('24px')).toBeNull()
    })

    it('gives the defaults for storage it cannot read', () => {
        expect(readSettings(store('not json'))).toEqual(DEFAULTS)
        expect(readSettings(store('42'))).toEqual(DEFAULTS)
    })
})

describe('writeSettings', () => {
    it('keeps the settings so readSettings gives them back', () => {
        let kept: string | null = null
        writeSettings({ setItem: (_key, value) => { kept = value } }, CHOSEN)
        expect(readSettings(store(kept))).toEqual(CHOSEN)
    })

    it('does not throw when the browser refuses storage', () => {
        expect(() => writeSettings({ setItem: () => { throw new Error('QuotaExceededError') } }, DEFAULTS)).not.toThrow()
    })
})

describe('stepSize and stepIn', () => {
    it('steps the size by 1 within 12 to 32', () => {
        expect(stepSize(18, 1)).toBe(19)
        expect(stepSize(18, -1)).toBe(17)
        expect(stepSize(32, 1)).toBe(32)
        expect(stepSize(12, -1)).toBe(12)
    })

    it('steps spacing by 0.1 without floating-point drift, within its range', () => {
        let value: number = LINE_SPACING.default
        for (let i = 0; i < 7; i++) value = stepIn(LINE_SPACING, value, 1)
        expect(value).toBe(2.2)
        expect(stepIn(LINE_SPACING, 2.5, 1)).toBe(2.5)
        expect(stepIn(LINE_SPACING, 1, -1)).toBe(1)
        expect(stepIn(INDENT, 1.4, -1)).toBe(1.3)
    })

    it('steps margins by 4 within 0 to 200', () => {
        expect(stepIn(MARGIN, 24, 1)).toBe(28)
        expect(stepIn(MARGIN, 0, -1)).toBe(0)
        expect(stepIn(MARGIN, 200, 1)).toBe(200)
    })
})

describe('marginsFor', () => {
    it('gives the screen\'s defaults until margins are chosen', () => {
        expect(marginsFor(DEFAULTS, false)).toEqual({ left: 24, right: 24, top: 16, bottom: 8 })
        expect(marginsFor(DEFAULTS, true)).toEqual({ left: 140, right: 140, top: 48, bottom: 12 })
        expect(marginsFor(CHOSEN, true)).toEqual(CHOSEN.margins)
        expect(PHONE_MARGINS).not.toBe(WIDE_MARGINS)
    })
})

describe('resetLayout', () => {
    it('resets size, spacing, margins and checkboxes and keeps the theme, font and progress', () => {
        expect(resetLayout(CHOSEN)).toEqual({ ...DEFAULTS, theme: 'dark', font: 'Noto Sans', progress: 'pages' })
    })
})

describe('bookStyles', () => {
    it('sets the theme colours over the book\'s own, keeping links, and the size on the root', () => {
        const css = bookStyles({ ...DEFAULTS, theme: 'sepia', size: 22 }, '@font-face {}')
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

    it('sets the spacing, indent, alignment and hyphenation of paragraphs', () => {
        const css = bookStyles(DEFAULTS, '')
        expect(css).toContain('p, li, blockquote, dd { line-height: 1.5 !important; text-align: justify !important; -webkit-hyphens: auto !important; hyphens: auto !important; }')
        expect(css).toContain('p { margin-top: 0 !important; margin-bottom: 0em !important; text-indent: 1.4em !important; }')
        expect(css).toContain(':is(h1, h2, h3, h4, h5, h6, hr) + p, body > p:first-child, section > p:first-child { text-indent: 0 !important; }')
        expect(css).toContain('[align="center"] { text-align: center !important; }')
        const plain = bookStyles({ ...DEFAULTS, justify: false, hyphenate: false, lineSpacing: 2, paragraphSpacing: 0.5, indent: 0 }, '')
        expect(plain).toContain('line-height: 2 !important; text-align: start !important; -webkit-hyphens: manual !important; hyphens: manual !important;')
        expect(plain).toContain('margin-bottom: 0.5em !important; text-indent: 0em !important;')
    })

    it('drops the chosen font and spacing with the book\'s own layout, keeping theme and size', () => {
        const css = bookStyles({ ...DEFAULTS, font: 'Literata', size: 24, theme: 'dark', bookLayout: true }, '@font-face {}')
        expect(css).not.toContain('font-family')
        expect(css).not.toContain('line-height')
        expect(css).not.toContain('text-indent')
        expect(css).toContain('font-size: 24px !important')
        expect(css).toContain('background: #101010 !important')
        expect(css).toContain('@font-face {}')
    })
})
