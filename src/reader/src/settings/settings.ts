/** A built-in theme: its name and colours for the page, its text and the reading footer. */
export interface Theme {
    name: string
    background: string
    text: string
    footer: string
}

export const THEMES = {
    light: { name: 'Light', background: '#ffffff', text: '#1b1b1b', footer: '#6b6b6b' },
    sepia: { name: 'Sepia', background: '#f4ecd8', text: '#3b2f22', footer: '#6e5a3e' },
    dark: { name: 'Dark', background: '#101010', text: '#d6d6d6', footer: '#9a9a9a' },
} satisfies Record<string, Theme>

export type ThemeId = keyof typeof THEMES

/** The fonts Preferences offers, by name, with the stack each sets. Default keeps the book's own. */
export const FONTS = {
    'Default': "Georgia, 'Times New Roman', serif",
    'Literata': "'Literata', Georgia, serif",
    'Noto Serif': "'Noto Serif', Georgia, serif",
    'Noto Sans': "'Noto Sans', system-ui, sans-serif",
    'Atkinson Hyperlegible': "'Atkinson Hyperlegible', system-ui, sans-serif",
} as const

export type FontName = keyof typeof FONTS

/** A stepped value's limits, step and default. */
export interface Range {
    min: number
    max: number
    step: number
    default: number
}

export const SIZE = { min: 12, max: 32, step: 1, default: 18 } as const satisfies Range
export const LINE_SPACING = { min: 1, max: 2.5, step: 0.1, default: 1.5 } as const satisfies Range
/** Paragraph spacing and indent, in em. */
export const PARAGRAPH_SPACING = { min: 0, max: 2, step: 0.1, default: 0 } as const satisfies Range
export const INDENT = { min: 0, max: 4, step: 0.1, default: 1.4 } as const satisfies Range
/** Each margin, in px. */
export const MARGIN = { min: 0, max: 200, step: 4 } as const

export interface Margins {
    left: number
    right: number
    top: number
    bottom: number
}

export const SIDES = ['left', 'right', 'top', 'bottom'] as const

/** The margins a phone and a wider screen start with. */
export const PHONE_MARGINS: Margins = { left: 24, right: 24, top: 16, bottom: 8 }
export const WIDE_MARGINS: Margins = { left: 140, right: 140, top: 48, bottom: 12 }

/** What the reader keeps for this device. */
export interface Settings {
    theme: ThemeId
    font: FontName
    size: number
    lineSpacing: number
    paragraphSpacing: number
    indent: number
    /** Null until the reader changes one: then the screen's defaults apply. */
    margins: Margins | null
    justify: boolean
    hyphenate: boolean
    /** The book's own font, spacing, indent, alignment and hyphenation over Oriel's. */
    bookLayout: boolean
}

export const DEFAULTS: Settings = {
    theme: 'light',
    font: 'Default',
    size: SIZE.default,
    lineSpacing: LINE_SPACING.default,
    paragraphSpacing: PARAGRAPH_SPACING.default,
    indent: INDENT.default,
    margins: null,
    justify: true,
    hyphenate: true,
    bookLayout: false,
}

const KEY = 'oriel-settings'

// To one decimal, so steps of 0.1 do not gather floating-point error.
const tenths = (value: number): number => Math.round(value * 10) / 10

const isTheme = (value: unknown): value is ThemeId => typeof value === 'string' && Object.hasOwn(THEMES, value)
const isFont = (value: unknown): value is FontName => typeof value === 'string' && Object.hasOwn(FONTS, value)
const inRange = (range: Range) => (value: unknown): value is number =>
    typeof value === 'number' && value >= range.min && value <= range.max
    && Math.abs(value / range.step - Math.round(value / range.step)) < 1e-6
const isMargin = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value >= MARGIN.min && value <= MARGIN.max
const isMargins = (value: unknown): value is Margins =>
    !!value && typeof value === 'object' && SIDES.every(side => isMargin((value as Record<string, unknown>)[side]))
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'

/** The settings kept in `storage`; anything missing or not a valid value is the default. */
export const readSettings = (storage: Pick<Storage, 'getItem'>): Settings => {
    let stored: Record<string, unknown> = {}
    try {
        const parsed: unknown = JSON.parse(storage.getItem(KEY) ?? '{}')
        if (parsed && typeof parsed === 'object') stored = parsed as Record<string, unknown>
    } catch {
        // Unreadable: the defaults.
    }
    const pick = <T>(key: keyof Settings, valid: (value: unknown) => value is T): T =>
        (valid(stored[key]) ? stored[key] : DEFAULTS[key]) as T
    const margins = stored.margins
    return {
        theme: pick('theme', isTheme),
        font: pick('font', isFont),
        size: pick('size', inRange(SIZE)),
        lineSpacing: tenths(pick('lineSpacing', inRange(LINE_SPACING))),
        paragraphSpacing: tenths(pick('paragraphSpacing', inRange(PARAGRAPH_SPACING))),
        indent: tenths(pick('indent', inRange(INDENT))),
        margins: isMargins(margins) ? { left: margins.left, right: margins.right, top: margins.top, bottom: margins.bottom } : null,
        justify: pick('justify', isBoolean),
        hyphenate: pick('hyphenate', isBoolean),
        bookLayout: pick('bookLayout', isBoolean),
    }
}

/** Keeps `settings` in `storage`; a browser that refuses storage keeps them for this visit only. */
export const writeSettings = (storage: Pick<Storage, 'setItem'>, settings: Settings): void => {
    try {
        storage.setItem(KEY, JSON.stringify(settings))
    } catch {
        // Private browsing or a full store.
    }
}

/** A value one step down (-1) or up (+1), kept within its range. */
export const stepIn = (range: Pick<Range, 'min' | 'max' | 'step'>, value: number, step: -1 | 1): number =>
    tenths(Math.min(range.max, Math.max(range.min, value + step * range.step)))

/** The text size one step smaller (-1) or larger (+1), kept within its range. */
export const stepSize = (size: number, step: -1 | 1): number => stepIn(SIZE, size, step)

/** The margins in use: the ones chosen, else the defaults for a phone or a wider screen. */
export const marginsFor = (settings: Settings, wide: boolean): Margins =>
    settings.margins ?? (wide ? WIDE_MARGINS : PHONE_MARGINS)

/** Size, spacing, margins and checkboxes back to the defaults; theme and font kept. */
export const resetLayout = (settings: Settings): Settings =>
    ({ ...DEFAULTS, theme: settings.theme, font: settings.font })

/**
 * The stylesheet foliate-js puts in each section of a reflowable book:
 * `fontFaces` (the bundled fonts' @font-face rules), the theme's colours
 * over the book's own (links keep theirs) and the text size. Unless the
 * book's own layout is chosen, also the chosen font over the book's own
 * except for code, and the spacing, indent, alignment and hyphenation of
 * its paragraphs and list items.
 */
export const bookStyles = (settings: Settings, fontFaces: string): string => {
    const theme = THEMES[settings.theme]
    const rules = [
        fontFaces,
        `html { color-scheme: ${settings.theme === 'dark' ? 'dark' : 'light'}; font-size: ${settings.size}px !important; }`,
        `html, body { color: ${theme.text} !important; background: ${theme.background} !important; }`,
        'body { font-size: 1rem !important; }',
        'body *:not(a) { color: inherit !important; background-color: transparent !important; }',
    ]
    if (settings.bookLayout) return rules.join('\n')
    if (settings.font !== 'Default') {
        rules.push(`body, body *:not(code):not(pre):not(kbd):not(samp) { font-family: ${FONTS[settings.font]} !important; }`)
    }
    const hyphens = settings.hyphenate ? 'auto' : 'manual'
    rules.push(
        `p, li, blockquote, dd { line-height: ${settings.lineSpacing} !important; text-align: ${settings.justify ? 'justify' : 'start'} !important; -webkit-hyphens: ${hyphens} !important; hyphens: ${hyphens} !important; }`,
        `p { margin-top: 0 !important; margin-bottom: ${settings.paragraphSpacing}em !important; text-indent: ${settings.indent}em !important; }`,
        // No indent for the first paragraph of a section or after a heading.
        ':is(h1, h2, h3, h4, h5, h6, hr) + p, body > p:first-child, section > p:first-child { text-indent: 0 !important; }',
        // A book's own align attribute still holds.
        ...['left', 'right', 'center'].map(align => `[align="${align}"] { text-align: ${align} !important; }`),
    )
    return rules.join('\n')
}
