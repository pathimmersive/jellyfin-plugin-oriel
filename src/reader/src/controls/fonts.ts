import type { FontRefusal, OwnFont } from '../api/client'
import { ownFontFace } from '../settings/settings'

/** The largest font file the server keeps: 5 MB. */
export const MAX_FONT_BYTES = 5 * 1024 * 1024

/** A family of the reader's own fonts: its name and its files, as the server lists them. */
export interface OwnFamily {
    name: string
    fonts: OwnFont[]
}

/** The files grouped by family, keeping the server's order: by family, then weight, upright before italic. */
export const familiesOf = (fonts: OwnFont[]): OwnFamily[] => {
    const families = new Map<string, OwnFont[]>()
    for (const font of fonts) families.set(font.family, [...families.get(font.family) ?? [], font])
    return [...families].map(([name, files]) => ({ name, fonts: files }))
}

/** A family's styles as its row lists them: 'Regular, Italic, Bold'. */
export const stylesOf = (family: OwnFamily): string => family.fonts.map(font => font.style).join(', ')

/** What the Your fonts sheet says when a file was not added. */
export const refusalMessage = (refusal: FontRefusal, fileName: string): string => ({
    tooLarge: `${fileName} is larger than 5 MB.`,
    notAFont: `${fileName} is not a TTF, OTF or WOFF2 font.`,
    tooMany: 'You already have 20 font files. Remove a font to add another.',
    failed: `${fileName} could not be added. Try again.`,
})[refusal]

/** The reader's own fonts, as Preferences shows and changes them. */
export interface OwnFonts {
    /** The families, in order. */
    families(): OwnFamily[]
    /** Whether the reader has a family of this name. */
    has(family: string): boolean
    /** The @font-face rules of every file loaded. */
    faces(): string
    /** Adds a file; null once it is added, else what to say about it. */
    add(file: File): Promise<string | null>
    /** Removes a family; false when that failed. */
    remove(family: string): Promise<boolean>
    /** Calls `changed` whenever the fonts change, as they load or are added or removed. */
    onChange(changed: () => void): void
}

/** What the fonts need: the server, and a URL the book's frames can load a file from. */
export interface OwnFontSources {
    load(): Promise<OwnFont[] | null>
    add(file: Blob): Promise<OwnFont | FontRefusal>
    file(id: string): Promise<Blob | null>
    remove(family: string): Promise<boolean>
    url(file: Blob): string
    forget(url: string): void
}

/**
 * The reader's own fonts, kept on the server. Each file is fetched once and
 * given to the book as a URL of its own, since a stylesheet cannot send the
 * reader's token. `ready` settles once the list and its files have loaded.
 */
export const createOwnFonts = (sources: OwnFontSources): OwnFonts & { ready: Promise<boolean> } => {
    let fonts: OwnFont[] = []
    const urls = new Map<string, string>()
    const listeners: (() => void)[] = []
    const changed = (): void => {
        for (const listener of listeners) listener()
    }
    const drop = (gone: OwnFont[]): void => {
        for (const { id } of gone) {
            const url = urls.get(id)
            if (url) sources.forget(url)
            urls.delete(id)
        }
    }
    const ready = (async (): Promise<boolean> => {
        const loaded = await sources.load()
        if (!loaded) return false
        await Promise.all(loaded.map(async font => {
            const file = await sources.file(font.id)
            if (file) urls.set(font.id, sources.url(file))
        }))
        fonts = loaded
        changed()
        return true
    })()
    return {
        ready,
        families: () => familiesOf(fonts),
        has: family => fonts.some(font => font.family === family),
        faces: () => fonts.filter(font => urls.has(font.id)).map(font => ownFontFace(font, urls.get(font.id)!)).join('\n'),
        async add(file) {
            if (file.size > MAX_FONT_BYTES) return refusalMessage('tooLarge', file.name)
            const added = await sources.add(file)
            if (typeof added === 'string') return refusalMessage(added, file.name)
            // The server keeps one file per family, weight and italic, and lists
            // them by family as SQLite compares text, then weight, upright first.
            const replaced = fonts.filter(font => font.family === added.family && font.weight === added.weight && font.italic === added.italic)
            drop(replaced)
            urls.set(added.id, sources.url(file))
            fonts = [...fonts.filter(font => !replaced.includes(font)), added].sort((a, b) =>
                (a.family < b.family ? -1 : a.family > b.family ? 1 : 0) || a.weight - b.weight || Number(a.italic) - Number(b.italic))
            changed()
            return null
        },
        async remove(family) {
            if (!await sources.remove(family)) return false
            drop(fonts.filter(font => font.family === family))
            fonts = fonts.filter(font => font.family !== family)
            changed()
            return true
        },
        onChange(listener) {
            listeners.push(listener)
        },
    }
}
