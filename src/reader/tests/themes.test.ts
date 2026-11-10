import { describe, expect, it } from 'vitest'
import { deleteWords } from '../src/controls/theme-sheet'
import { createOwnThemes } from '../src/controls/themes'
import { accentInk, bookStyles, controlsColours, DEFAULTS, isDark, type OwnTheme, ownTheme, ownThemeOf, pageColours, readSettings, startingColours, THEME_ROLES, themeShown } from '../src/settings/settings'

// Night Blue, as the canvas draws it.
const NIGHT_BLUE: OwnTheme = {
    id: 'a1', name: 'Night Blue',
    background: '#0f1a2a', text: '#d7dee8', secondary: '#9fb0c4', accent: '#7cc4ff', selection: '#2e5a85',
    separator: '#2b4466', controls: '#14243a', controlsText: '#e6edf5', buttons: '#23395a', grayed: '#6c7f96',
}

describe('the ten colours', () => {
    it('lists them as New theme does, with their names and uses', () => {
        expect(THEME_ROLES.map(([, name]) => name)).toEqual(['Background', 'Text', 'Secondary text', 'Accent', 'Selection', 'Separator', 'Controls', 'Controls text', 'Buttons', 'Grayed'])
        expect(THEME_ROLES[6]).toEqual(['controls', 'Controls', 'The header, footer and panels'])
    })
})

describe('startingColours', () => {
    it('starts from a built-in theme\'s page with Jellyfin\'s controls', () => {
        expect(startingColours('dark')).toEqual({
            background: '#101010', text: '#d6d6d6', secondary: '#9a9a9a', accent: '#00a4dc', selection: '#00506b',
            separator: '#2e2e2e', controls: '#202020', controlsText: '#dedede', buttons: '#424242', grayed: '#6b6b6b',
        })
        expect(startingColours('light').selection).toBe('#b8e6f5')
        expect(startingColours('sepia')).toMatchObject({ background: '#f4ecd8', text: '#3b2f22', secondary: '#6e5a3e', selection: '#b0d8d9' })
    })

    it('starts from a custom theme\'s own colours', () => {
        const { id: _id, name: _name, ...colours } = NIGHT_BLUE
        expect(startingColours(NIGHT_BLUE)).toEqual(colours)
    })
})

describe('the theme shown', () => {
    it('is the reader\'s own theme while they have it, else Light', () => {
        expect(ownThemeOf(ownTheme('a1'))).toBe('a1')
        expect(ownThemeOf('sepia')).toBeNull()
        expect(themeShown('sepia', [NIGHT_BLUE])).toBe('sepia')
        expect(themeShown(ownTheme('a1'), [NIGHT_BLUE])).toBe(NIGHT_BLUE)
        expect(themeShown(ownTheme('gone'), [NIGHT_BLUE])).toBe('light')
    })

    it('keeps a chosen custom theme on this device', () => {
        expect(readSettings({ getItem: () => JSON.stringify({ theme: 'own:a1' }) }).theme).toBe('own:a1')
        expect(readSettings({ getItem: () => JSON.stringify({ theme: 'own:' }) }).theme).toBe('light')
    })

    it('colours the page and reading footer from Background, Text and Secondary text', () => {
        expect(pageColours(NIGHT_BLUE)).toEqual({ name: 'Night Blue', background: '#0f1a2a', text: '#d7dee8', footer: '#9fb0c4' })
        expect(pageColours('light')).toEqual({ name: 'Light', background: '#ffffff', text: '#1b1b1b', footer: '#6b6b6b' })
    })
})

describe('a custom theme in the reader', () => {
    it('colours the controls', () => {
        expect(controlsColours(NIGHT_BLUE)).toEqual({
            '--chrome': '#14243a', '--chrome-ink': '#e6edf5', '--sub': '#9fb0c4', '--accent': '#7cc4ff',
            '--accent-ink': 'rgba(0, 0, 0, .87)', '--divider': '#2b4466', '--raised': '#23395a', '--grayed': '#6c7f96',
        })
    })

    it('puts white text on a dark accent and near-black on a light one', () => {
        expect(accentInk('#a3521a')).toBe('#ffffff')
        expect(accentInk('#00a4dc')).toBe('rgba(0, 0, 0, .87)')
        expect(isDark('#0f1a2a')).toBe(true)
        expect(isDark('#f7f3ea')).toBe(false)
    })

    it('colours the book\'s text, background and selection, in its colour scheme', () => {
        const css = bookStyles({ ...DEFAULTS, theme: ownTheme('a1') }, '', [NIGHT_BLUE])
        expect(css).toContain('color-scheme: dark')
        expect(css).toContain('html, body { color: #d7dee8 !important; background: #0f1a2a !important; }')
        expect(css).toContain('::selection { background: #2e5a85; }')
        const light = bookStyles({ ...DEFAULTS, theme: ownTheme('gone') }, '', [NIGHT_BLUE])
        expect(light).toContain('color: #1b1b1b !important; background: #ffffff !important')
        expect(light).not.toContain('::selection')
    })
})

describe('the Delete theme dialog', () => {
    it('says Oriel will switch to Light when the theme is in use', () => {
        expect(deleteWords('Night Blue', true)).toEqual({ title: 'Delete Night Blue?', body: 'You are reading with this theme now, so Oriel will switch to Light.' })
        expect(deleteWords('Paper', false)).toEqual({ title: 'Delete Paper?', body: 'This theme will be removed from all your devices.' })
    })
})

describe('createOwnThemes', () => {
    it('has none until the server\'s list loads, and takes the list as kept', async () => {
        const kept: OwnTheme[] = []
        const themes = createOwnThemes({ load: async () => [NIGHT_BLUE], save: async list => list.map((theme, at) => ({ id: theme.id ?? `new${at}`, ...theme }) as OwnTheme) })
        expect(themes.list()).toEqual([])
        let changes = 0
        themes.onChange(() => { changes++ })
        expect(await themes.ready).toBe(true)
        expect(themes.list()).toEqual([NIGHT_BLUE])
        const { id: _id, ...paper } = { ...NIGHT_BLUE, name: 'Paper' }
        kept.push(...(await themes.save([NIGHT_BLUE, paper]))!)
        expect(kept.map(theme => theme.id)).toEqual(['a1', 'new1'])
        expect(themes.list()).toEqual(kept)
        expect(changes).toBe(2)
    })

    it('keeps the list it has when the server does not take a change', async () => {
        const themes = createOwnThemes({ load: async () => [NIGHT_BLUE], save: async () => null })
        await themes.ready
        expect(await themes.save([])).toBeNull()
        expect(themes.list()).toEqual([NIGHT_BLUE])
    })
})
