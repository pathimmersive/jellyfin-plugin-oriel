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

/** A font as Preferences chooses it: a bundled one by name, or one of the reader's own families as `own:<family>`. */
export type FontChoice = FontName | `own:${string}`

/** The choice of one of the reader's own families. */
export const ownFont = (family: string): FontChoice => `own:${family}`

/** The family of a choice of the reader's own, or null for a bundled font. */
export const ownFamilyOf = (font: FontChoice): string | null => font.startsWith('own:') ? font.slice(4) : null

/** A string as CSS writes it, quoted. */
const cssString = (text: string): string => `'${text.replace(/[\\'\n\r\f]/g, character => `\\${character.charCodeAt(0).toString(16)} `)}'`

/**
 * The CSS family a family of the reader's own is declared as: named apart
 * from the bundled fonts and any installed font of the same name.
 */
export const ownFontFamily = (family: string): string => cssString(`Oriel own: ${family}`)

/** The stack a font choice sets. */
export const fontStack = (font: FontChoice): string => {
    const family = ownFamilyOf(font)
    return family === null ? FONTS[font as FontName] : `${ownFontFamily(family)}, Georgia, serif`
}

/** The @font-face rule of one of the reader's own font files, at `url`. */
export const ownFontFace = (font: { family: string, weight: number, italic: boolean, format: string }, url: string): string =>
    `@font-face { font-family: ${ownFontFamily(font.family)}; font-style: ${font.italic ? 'italic' : 'normal'}; font-weight: ${font.weight}; font-display: swap; src: url(${cssString(url)}) format('${({ ttf: 'truetype', otf: 'opentype', woff2: 'woff2' } as Record<string, string>)[font.format] ?? font.format}'); }`

/** How the footers show progress: the percent read, or page / total. */
export const PROGRESS = ['percent', 'pages'] as const

export type Progress = typeof PROGRESS[number]

/** How pages turn: slide across, scroll as one column, fade, or jump. */
export const PAGE_TURNS = ['slide', 'scroll', 'fade', 'none'] as const

export type PageTurn = typeof PAGE_TURNS[number]

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
    font: FontChoice
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
    progress: Progress
    pageTurn: PageTurn
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
    progress: 'percent',
    pageTurn: 'slide',
}

const KEY = 'oriel-settings'

// To one decimal, so steps of 0.1 do not gather floating-point error.
const tenths = (value: number): number => Math.round(value * 10) / 10

const isTheme = (value: unknown): value is ThemeId => typeof value === 'string' && Object.hasOwn(THEMES, value)
const isFont = (value: unknown): value is FontChoice =>
    typeof value === 'string' && (Object.hasOwn(FONTS, value) || (value.startsWith('own:') && value.length > 4))
const inRange = (range: Range) => (value: unknown): value is number =>
    typeof value === 'number' && value >= range.min && value <= range.max
    && Math.abs(value / range.step - Math.round(value / range.step)) < 1e-6
const isMargin = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value >= MARGIN.min && value <= MARGIN.max
const isMargins = (value: unknown): value is Margins =>
    !!value && typeof value === 'object' && SIDES.every(side => isMargin((value as Record<string, unknown>)[side]))
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'
const isProgress = (value: unknown): value is Progress => (PROGRESS as readonly unknown[]).includes(value)
const isPageTurn = (value: unknown): value is PageTurn => (PAGE_TURNS as readonly unknown[]).includes(value)

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
        progress: pick('progress', isProgress),
        pageTurn: pick('pageTurn', isPageTurn),
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

/** Size, spacing, margins, page turn and checkboxes back to the defaults; theme, font and progress kept. */
export const resetLayout = (settings: Settings): Settings =>
    ({ ...DEFAULTS, theme: settings.theme, font: settings.font, progress: settings.progress })

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
        rules.push(`body, body *:not(code):not(pre):not(kbd):not(samp) { font-family: ${fontStack(settings.font)} !important; }`)
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
