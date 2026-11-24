import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../src', import.meta.url))

const filesUnder = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
        entry.isDirectory() ? filesUnder(join(dir, entry.name)) : entry.name.endsWith('.ts') ? [join(dir, entry.name)] : [])

const name = (file: string): string => relative(root, file).split(sep).join('/')

// What each module imports of the reader's own, types included.
const imports = new Map(filesUnder(root).map(file => [name(file),
    [...readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*\(?\s*'(\.[^']*)'/g)]
        .map(([, path]) => `${resolve(dirname(file), path)}.ts`)
        .filter(existsSync)
        .map(name)]))

/** The modules of the first circle found, the first one again at the end; empty when there is none. */
const circle = (modules: ReadonlyMap<string, string[]>): string[] => {
    const done = new Set<string>()
    const visit = (module: string, path: string[]): string[] => {
        if (path.includes(module)) return [...path.slice(path.indexOf(module)), module]
        if (done.has(module)) return []
        for (const imported of modules.get(module) ?? []) {
            const found = visit(imported, [...path, module])
            if (found.length) return found
        }
        done.add(module)
        return []
    }
    for (const module of modules.keys()) {
        const found = visit(module, [])
        if (found.length) return found
    }
    return []
}

describe('modules', () => {
    it('are read with what they import', () => {
        expect(imports.get('main.ts')).toContain('controls/controls.ts')
        expect(imports.get('controls/controls.ts')).toContain('controls/preferences.ts')
        expect(imports.get('engine/engine.ts')!.length).toBeGreaterThan(0)
    })

    it('finds a circle, however long', () => {
        expect(circle(new Map([['a', ['b']], ['b', ['c']], ['c', ['b']]]))).toEqual(['b', 'c', 'b'])
        expect(circle(new Map([['a', ['a']]]))).toEqual(['a', 'a'])
        expect(circle(new Map([['a', ['b', 'c']], ['b', ['c']], ['c', []]]))).toEqual([])
    })

    it('import no other module in a circle', () => {
        expect(circle(imports)).toEqual([])
    })
})
