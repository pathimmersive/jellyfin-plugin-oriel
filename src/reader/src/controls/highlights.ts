import type { Highlight } from '../api/client'
import { bookmarkWhere, cutAtWord } from './bookmarks'

/** The longest text a highlight keeps, as the server takes it. */
export const HIGHLIGHT_TEXT = 1000

/** The text a highlight keeps: the text selected, spaces evened, cut at a word to HIGHLIGHT_TEXT characters. */
export const highlightText = (selected: string): string => cutAtWord(selected, HIGHLIGHT_TEXT)

/** The longest note a highlight keeps, as the server takes it. */
export const NOTE_LENGTH = 2000

/** A row of the Highlights tab: `colour` is its highlighter's id. */
export interface HighlightRow {
    id: string
    text: string
    colour: string
    note: string
    where: string
}

/** A change to a highlight: its highlighter (by id), its note (empty for none), or both. */
export interface HighlightChange {
    colour?: string
    note?: string
}

/** The book's highlights, as the page and the Highlights tab show and change them. */
export interface Highlights {
    /** The highlights of a colour (all for null) in book order. */
    rows(colour: string | null): HighlightRow[]
    /** Every highlight, for drawing on the page. */
    all(): Highlight[]
    /** The highlight at a CFI, or null. */
    at(cfi: string): Highlight | null
    /** Highlights text, with a note (empty for none); false when the server did not take it. */
    add(cfi: string, fraction: number, colour: string, text: string, note?: string): Promise<boolean>
    /** Changes a highlight's highlighter, its note, or both. */
    update(id: string, change: HighlightChange): Promise<void>
    /** Removes a highlight. */
    remove(id: string): Promise<void>
    /** Goes to a highlight, as a reader move. */
    go(id: string): Promise<void>
    /** Reads the highlights again, as after a highlighter's deletion moved some to Quotes. */
    reload(): Promise<void>
    /** Calls `changed` whenever the highlights change, as they load or are added, changed or removed. */
    onChange(changed: () => void): void
}

/** What the highlights need: the server, and the book. */
export interface HighlightSources {
    load(): Promise<Highlight[] | null>
    add(cfi: string, fraction: number, colour: string, text: string, note: string): Promise<Highlight | null>
    update(id: string, change: HighlightChange): Promise<Highlight | null>
    remove(id: string): Promise<boolean>
    /** Book order of two places: negative when `a` comes first. */
    compare(a: string, b: string): number
    /** The name of the chapter a place is in. */
    chapterOf(cfi: string): string
    go(cfi: string): Promise<void>
}

/**
 * The book's highlights, kept on the server. They load in the background; a
 * change shows once the server has taken it, so a failed one changes nothing.
 */
export const createHighlights = (sources: HighlightSources): Highlights => {
    let kept: Highlight[] = []
    const listeners: (() => void)[] = []
    const changed = (): void => {
        kept.sort((a, b) => sources.compare(a.cfi, b.cfi) || a.createdAt.localeCompare(b.createdAt))
        for (const listener of listeners) listener()
    }
    // A highlight the server returns replaces the one with its id.
    const keep = (highlight: Highlight): void => {
        kept = [...kept.filter(each => each.id !== highlight.id), highlight]
        changed()
    }
    const load = async (): Promise<void> => {
        const loaded = await sources.load()
        if (!loaded) return
        // A highlight added while the list loaded stays.
        const ids = new Set(loaded.map(highlight => highlight.id))
        kept = [...loaded, ...kept.filter(highlight => !ids.has(highlight.id))]
        changed()
    }
    void load()
    return {
        rows: colour => kept
            .filter(highlight => colour === null || highlight.colour === colour)
            .map(({ id, cfi, fraction, colour, text, note }) => ({
                id, text, colour, note, where: bookmarkWhere(sources.chapterOf(cfi), fraction),
            })),
        all: () => [...kept],
        at: cfi => kept.find(highlight => highlight.cfi === cfi) ?? null,
        async add(cfi, fraction, colour, text, note = '') {
            const added = await sources.add(cfi, fraction, colour, text, note)
            if (added) keep(added)
            return !!added
        },
        async update(id, change) {
            const changed = await sources.update(id, change)
            if (changed) keep(changed)
        },
        async remove(id) {
            if (!await sources.remove(id)) return
            kept = kept.filter(highlight => highlight.id !== id)
            changed()
        },
        reload: load,
        async go(id) {
            const highlight = kept.find(candidate => candidate.id === id)
            if (highlight) await sources.go(highlight.cfi)
        },
        onChange(listener) {
            listeners.push(listener)
        },
    }
}
