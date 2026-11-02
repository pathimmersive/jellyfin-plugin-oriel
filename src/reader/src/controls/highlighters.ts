import type { HighlighterRecord } from '../api/client'

/** A highlighter as the reader shows it: its id, its name, the colour of its dot, how strongly it fills text, whether it is built in, and how many highlights use it. */
export interface Highlighter {
    id: string
    name: string
    solid: string
    fill: number
    builtIn: boolean
    uses: number
}

/** The most highlighters a reader keeps, built-ins included. */
export const MAX_HIGHLIGHTERS = 8

/** The longest name a highlighter keeps, as the server takes it. */
export const NAME_LENGTH = 40

/** The four built-in highlighters, as the canvas draws them; a reader who has changed nothing has these. */
export const BUILT_INS: readonly HighlighterRecord[] = [
    { id: 'yellow', name: 'Quotes', colour: '#ffd54f', builtIn: true, uses: 0 },
    { id: 'green', name: 'Green', colour: '#81c784', builtIn: true, uses: 0 },
    { id: 'blue', name: 'Vocabulary', colour: '#64b5f6', builtIn: true, uses: 0 },
    { id: 'pink', name: 'Pink', colour: '#f06292', builtIn: true, uses: 0 },
]

// How strongly each built-in fills text, as the canvas draws them; a reader's own fills at half.
const BUILT_IN_FILLS: Record<string, number> = { yellow: 0.5, green: 0.45, blue: 0.45, pink: 0.38 }
const OWN_FILL = 0.5

/** The New highlighter sheet's twelve colours, with their names. */
export const SWATCHES: readonly { solid: string, name: string }[] = [
    { solid: '#ffd54f', name: 'Yellow' }, { solid: '#ffb74d', name: 'Orange' }, { solid: '#e57373', name: 'Red' },
    { solid: '#f06292', name: 'Pink' }, { solid: '#ba68c8', name: 'Violet' }, { solid: '#b39ddb', name: 'Lavender' },
    { solid: '#7986cb', name: 'Indigo' }, { solid: '#64b5f6', name: 'Blue' }, { solid: '#4dd0e1', name: 'Cyan' },
    { solid: '#4db6ac', name: 'Teal' }, { solid: '#81c784', name: 'Green' }, { solid: '#a1887f', name: 'Brown' },
]

/** A highlighter as the server keeps it, as the reader shows it. */
export const asHighlighter = ({ id, name, colour, builtIn, uses }: HighlighterRecord): Highlighter =>
    ({ id, name, solid: colour, fill: BUILT_IN_FILLS[id] ?? OWN_FILL, builtIn, uses })

/** The colour a highlighter fills text with: its dot's colour at its strength. */
export const highlightFill = ({ solid, fill }: Pick<Highlighter, 'solid' | 'fill'>): string => {
    const [red, green, blue] = [1, 3, 5].map(at => parseInt(solid.slice(at, at + 2), 16))
    return `rgba(${red}, ${green}, ${blue}, ${fill})`
}

/** A highlighter's name: the one given, else its swatch's, else 'My colour'. */
export const highlighterName = (given: string, solid: string): string =>
    given.trim() || SWATCHES.find(swatch => swatch.solid === solid.toLowerCase())?.name || 'My colour'

/** The first swatch no highlighter has yet, for a new one; the first swatch when all are used. */
export const firstUnused = (highlighters: readonly Pick<Highlighter, 'solid'>[]): string =>
    (SWATCHES.find(swatch => !highlighters.some(highlighter => highlighter.solid.toLowerCase() === swatch.solid)) ?? SWATCHES[0]).solid

/** A list with the entry at `from` moved to `to`. */
export const moved = <T>(list: readonly T[], from: number, to: number): T[] => {
    const next = [...list]
    const [entry] = next.splice(from, 1)
    next.splice(to, 0, entry)
    return next
}

/** A highlighter in a whole list sent to be kept: a new one has no id. */
export interface HighlighterEdit {
    id?: string
    name: string
    colour: string
}

/** The reader's highlighters, kept on the server. */
export interface Highlighters {
    /** The highlighters in their order. */
    list(): Highlighter[]
    /** The highlighter with an id; Quotes for one the reader does not have. */
    find(id: string): Highlighter
    /** Keeps a whole list; the highlighters as kept, or null when the server did not take it. */
    save(list: HighlighterEdit[]): Promise<Highlighter[] | null>
    /** Reads the list again, with up-to-date counts of the highlights using each. */
    refresh(): Promise<void>
    /** Calls `changed` whenever the list changes. */
    onChange(changed: () => void): void
}

/** What the highlighters need: the server. */
export interface HighlighterSources {
    load(): Promise<HighlighterRecord[] | null>
    save(list: HighlighterEdit[]): Promise<HighlighterRecord[] | null>
}

/** The reader's highlighters: the built-ins until the server's list loads. */
export const createHighlighters = (sources: HighlighterSources): Highlighters => {
    let kept = BUILT_INS.map(asHighlighter)
    const listeners: (() => void)[] = []
    const take = (records: HighlighterRecord[]): Highlighter[] => {
        kept = records.map(asHighlighter)
        for (const listener of listeners) listener()
        return kept
    }
    const refresh = async (): Promise<void> => {
        const loaded = await sources.load()
        if (loaded) take(loaded)
    }
    void refresh()
    return {
        list: () => [...kept],
        find: id => kept.find(highlighter => highlighter.id === id) ?? kept.find(highlighter => highlighter.id === 'yellow') ?? asHighlighter(BUILT_INS[0]),
        async save(list) {
            const saved = await sources.save(list)
            return saved ? take(saved) : null
        },
        refresh,
        onChange(listener) {
            listeners.push(listener)
        },
    }
}
