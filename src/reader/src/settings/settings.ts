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

export const SIZE = { min: 12, max: 32, default: 18 } as const

/** What the reader keeps for this device. */
export interface Settings {
    theme: ThemeId
    font: FontName
    size: number
}

export const DEFAULTS: Settings = { theme: 'light', font: 'Default', size: SIZE.default }

const KEY = 'oriel-settings'

const isTheme = (value: unknown): value is ThemeId => typeof value === 'string' && Object.hasOwn(THEMES, value)
const isFont = (value: unknown): value is FontName => typeof value === 'string' && Object.hasOwn(FONTS, value)
const isSize = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value >= SIZE.min && value <= SIZE.max

/** The settings kept in `storage`; anything missing or not a valid value is the default. */
export const readSettings = (storage: Pick<Storage, 'getItem'>): Settings => {
    let stored: Record<string, unknown> = {}
    try {
        const parsed: unknown = JSON.parse(storage.getItem(KEY) ?? '{}')
        if (parsed && typeof parsed === 'object') stored = parsed as Record<string, unknown>
    } catch {
        // Unreadable: the defaults.
    }
    return {
        theme: isTheme(stored.theme) ? stored.theme : DEFAULTS.theme,
        font: isFont(stored.font) ? stored.font : DEFAULTS.font,
        size: isSize(stored.size) ? stored.size : DEFAULTS.size,
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

/** The text size one step smaller (-1) or larger (+1), kept within its range. */
export const stepSize = (size: number, step: -1 | 1): number => Math.min(SIZE.max, Math.max(SIZE.min, size + step))

/**
 * The stylesheet foliate-js puts in each section of a reflowable book:
 * `fontFaces` (the bundled fonts' @font-face rules), the theme's colours
 * over the book's own (links keep theirs), the text size, and the chosen
 * font over the book's own except for code.
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
    if (settings.font !== 'Default') {
        rules.push(`body, body *:not(code):not(pre):not(kbd):not(samp) { font-family: ${FONTS[settings.font]} !important; }`)
    }
    return rules.join('\n')
}
