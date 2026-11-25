import { describe, expect, it } from 'vitest'
import { readChoices, saveChoices } from '../src/api/client'
import { createChoices } from '../src/controls/choices'
import { type Choices, choicesOf, DEFAULTS, type KeptChoices, type Settings, withChoices } from '../src/settings/settings'

// A device that has made its own layout, reading in Sepia with Literata.
const DEVICE: Settings = {
    ...DEFAULTS,
    theme: 'sepia', font: 'Literata', size: 22, lineSpacing: 1.8, paragraphSpacing: 0.5, indent: 2,
    margins: { left: 40, right: 40, top: 20, bottom: 10 }, justify: false, hyphenate: false, bookLayout: true,
    progress: 'pages', pageTurn: 'fade',
}

const memory = (): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { items: Map<string, string> } => {
    const items = new Map<string, string>()
    return {
        items,
        getItem: key => items.get(key) ?? null,
        setItem: (key, value) => { items.set(key, value) },
        removeItem: key => { items.delete(key) },
    }
}

// Lets the promises waiting on a send or a wait run.
const settle = async (): Promise<void> => {
    for (let turn = 0; turn < 10; turn++) await Promise.resolve()
}

describe('what follows the reader', () => {
    it('is the theme and font', () => {
        expect(choicesOf(DEVICE)).toEqual({ theme: 'sepia', font: 'Literata' })
    })

    it('takes the server\'s theme and font and keeps the rest as this device has them', () => {
        expect(withChoices(DEVICE, { theme: 'own:a1', font: 'own:Merriweather' })).toEqual({ ...DEVICE, theme: 'own:a1', font: 'own:Merriweather' })
    })

    it('keeps this device\'s choice for one the server does not have or Oriel does not know', () => {
        expect(withChoices(DEVICE, null)).toEqual(DEVICE)
        expect(withChoices(DEVICE, { theme: null, font: null })).toEqual(DEVICE)
        expect(withChoices(DEVICE, { theme: 'solarized', font: 'own:' })).toEqual(DEVICE)
        expect(withChoices(DEVICE, { theme: 'dark', font: null })).toEqual({ ...DEVICE, theme: 'dark' })
    })
})

describe('readChoices', () => {
    const answering = (body: unknown, status = 200) => (() => Promise.resolve(new Response(JSON.stringify(body), { status }))) as unknown as typeof fetch

    it('reads a choice not made yet, which the server leaves out, as none', async () => {
        expect(await readChoices('/jf', 'auth', answering({}))).toEqual({ theme: null, font: null })
        expect(await readChoices('/jf', 'auth', answering({ theme: 'dark', font: 'own:Merriweather' }))).toEqual({ theme: 'dark', font: 'own:Merriweather' })
    })

    it('is null when the server cannot answer or answers with something else', async () => {
        expect(await readChoices('/jf', 'auth', answering({}, 500))).toBeNull()
        expect(await readChoices('/jf', 'auth', answering({ theme: 3 }))).toBeNull()
    })
})

describe('saveChoices', () => {
    const answering = (status: number) => (() => Promise.resolve(new Response(null, { status }))) as unknown as typeof fetch

    it('tells a session that has ended from a server that cannot be reached', async () => {
        expect(await saveChoices('', 'h', { theme: 'dark', font: 'Default' }, answering(401))).toBe('signedOut')
        for (const status of [500, 503, 408, 429]) expect(await saveChoices('', 'h', { theme: 'dark', font: 'Default' }, answering(status))).toBe(false)
        for (const status of [200, 400]) expect(await saveChoices('', 'h', { theme: 'dark', font: 'Default' }, answering(status))).toBe(true)
    })
})

describe('createChoices', () => {
    const sources = (save: (choices: Choices) => Promise<boolean | 'signedOut'>, load: () => Promise<KeptChoices | null> = () => Promise.resolve({ theme: 'dark', font: 'Default' })) => {
        const storage = memory()
        const waits: number[] = []
        const sent: Choices[] = []
        return {
            storage, waits, sent,
            load,
            save: (choices: Choices) => { sent.push(choices); return save(choices) },
            wait: (ms: number) => { waits.push(ms); return Promise.resolve() },
        }
    }

    it('opens with the server\'s choice', async () => {
        const source = sources(() => Promise.resolve(true))
        expect(await createChoices(source, choicesOf(DEVICE)).ready).toEqual({ theme: 'dark', font: 'Default' })
        expect(source.sent).toEqual([])
    })

    it('sends a choice at once and forgets it once the server has it', async () => {
        const source = sources(() => Promise.resolve(true))
        const chosen = createChoices(source, choicesOf(DEVICE))
        chosen.choose({ theme: 'own:a1', font: 'Default' })
        await settle()
        expect(source.sent).toEqual([{ theme: 'own:a1', font: 'Default' }])
        expect(source.storage.items.size).toBe(0)
    })

    it('keeps a choice made offline and sends it, waiting longer each time, once the server answers', async () => {
        let up = false
        const source = sources(() => Promise.resolve(up))
        const chosen = createChoices(source, choicesOf(DEVICE))
        chosen.choose({ theme: 'dark', font: 'Literata' })
        await settle()
        expect(source.storage.items.size).toBe(1)
        expect(source.waits.slice(0, 3)).toEqual([2000, 4000, 8000])
        up = true
        await settle()
        expect(source.sent.at(-1)).toEqual({ theme: 'dark', font: 'Literata' })
        expect(source.storage.items.size).toBe(0)
    })

    it('stops sending once signed out, keeping the choice for the next open', async () => {
        const source = sources(() => Promise.resolve('signedOut'))
        const chosen = createChoices(source, choicesOf(DEVICE))
        chosen.choose({ theme: 'dark', font: 'Literata' })
        await settle()
        expect(source.sent).toHaveLength(1)
        expect(source.waits).toEqual([])
        expect(source.storage.items.size).toBe(1)
        chosen.choose({ theme: 'light', font: 'Literata' })
        await settle()
        expect(source.sent).toHaveLength(1)
        expect(source.storage.items.size).toBe(1)
        // Signed in again, the reader opens anew and sends this device's choice.
        const again = { ...sources(() => Promise.resolve(true)), storage: source.storage }
        expect(await createChoices(again, choicesOf(DEVICE)).ready).toBeNull()
        await settle()
        expect(again.sent).toEqual([{ theme: 'sepia', font: 'Literata' }])
        expect(source.storage.items.size).toBe(0)
    })

    it('sends only the latest of choices made while one is on its way', async () => {
        let answer: (ok: boolean) => void = () => {}
        const source = sources(() => new Promise(resolve => { answer = resolve }))
        const chosen = createChoices(source, choicesOf(DEVICE))
        chosen.choose({ theme: 'dark', font: 'Default' })
        chosen.choose({ theme: 'light', font: 'Default' })
        chosen.choose({ theme: 'sepia', font: 'Noto Sans' })
        await settle()
        answer(true)
        await settle()
        answer(true)
        await settle()
        expect(source.sent).toEqual([{ theme: 'dark', font: 'Default' }, { theme: 'sepia', font: 'Noto Sans' }])
        expect(source.storage.items.size).toBe(0)
    })

    it('on the next open sends this device\'s choice not yet sent, instead of taking the server\'s', async () => {
        const source = sources(() => Promise.resolve(true))
        source.storage.setItem('oriel-choices-unsent', '1')
        expect(await createChoices(source, choicesOf(DEVICE)).ready).toBeNull()
        await settle()
        expect(source.sent).toEqual([{ theme: 'sepia', font: 'Literata' }])
        expect(source.storage.items.size).toBe(0)
    })

    it('opens with this device\'s choice when the server cannot be reached', async () => {
        const source = sources(() => Promise.resolve(false), () => Promise.resolve(null))
        expect(withChoices(DEVICE, await createChoices(source, choicesOf(DEVICE)).ready)).toEqual(DEVICE)
    })
})
