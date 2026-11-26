import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))

const filesUnder = (dir: string): string[] =>
    readdirSync(join(root, dir), { withFileTypes: true }).flatMap(entry =>
        entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)])

const sources = [...filesUnder('src'), 'index.html'].map(file => ({
    path: relative(root, join(root, file)).split(sep).join('/'),
    text: readFileSync(join(root, file), 'utf8'),
}))

describe('module boundaries', () => {
    it('only the session module reads the jellyfin-web credentials', () => {
        const readers = sources.filter(s => s.text.includes('jellyfin_credentials')).map(s => s.path)
        expect(readers).toEqual(['src/session/credentials.ts'])
    })

    it('only the engine module imports foliate-js', () => {
        const importers = sources.filter(s => s.text.includes('vendor/foliate-js')).map(s => s.path)
        expect(importers).toEqual(['src/engine/engine.ts'])
    })
})

describe('shared code', () => {
    const typed = sources.filter(s => s.path.endsWith('.ts'))
    const holding = (pattern: RegExp): string[] => typed.flatMap(s => [...s.text.matchAll(pattern)].map(() => s.path))

    it('only the icons module keeps icon paths and draws an icon', () => {
        expect([...new Set(holding(/'M\d/g))]).toEqual(['src/controls/icons.ts'])
        expect(sources.filter(s => s.text.includes('viewBox="0 0 24 24"')).map(s => s.path)).toEqual(['src/controls/icons.ts'])
    })

    it('only the client fetches: once in ask, and once for the book download', () => {
        expect(holding(/\bfetch(?:Impl)?\(/g)).toEqual(['src/api/client.ts', 'src/api/client.ts'])
        expect(sources.find(s => s.path === 'src/api/client.ts')?.text).toMatch(/export const ask = [\s\S]*?return await fetchImpl\(url, init\)/)
    })

    it('only the listeners module keeps a list of listeners', () => {
        expect(holding(/: \(\(\) => void\)\[\] = \[\]/g)).toEqual(['src/controls/listeners.ts'])
    })

    it('only the events module reads an event as a CustomEvent', () => {
        expect(holding(/as CustomEvent\b/g)).toEqual(['src/engine/events.ts'])
    })
})

describe('foliate-js pin', () => {
    it('records the vendored commit', () => {
        const record = readFileSync(join(root, 'vendor/foliate-js.commit'), 'utf8')
        expect(record).toMatch(/^commit: 78914aef4466eb960965702401634c2cb348e9b1$/m)
    })

    it('keeps the upstream license with the copy', () => {
        expect(readFileSync(join(root, 'vendor/foliate-js/LICENSE'), 'utf8')).toMatch(/MIT/)
    })
})
