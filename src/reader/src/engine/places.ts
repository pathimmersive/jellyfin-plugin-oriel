// Places in a book (CFIs), read once each: a reader may keep thousands of marks.

/** foliate-js's CFI functions, as they are used here. */
export interface CfiReader {
    parse(cfi: string): unknown
    /** The start of a parsed CFI's range, or its end; a point is both. */
    collapse(parsed: unknown, toEnd?: boolean): unknown
    /** Book order of two parsed points. */
    compare(a: unknown, b: unknown): number
}

/** All of foliate-js's CFI functions this reader uses. */
export interface Cfi extends CfiReader {
    /** Matches a CFI written `epubcfi(...)`. */
    isCFI: RegExp
    /** The start of a CFI's range, or its end, as a CFI again. */
    collapse(cfi: string, toEnd?: boolean): string
    collapse(parsed: unknown, toEnd?: boolean): unknown
}

export interface Places {
    /** Book order of two places: negative when `a` comes first. One that cannot be read comes last. */
    compare: (a: string, b: string) => number
    /** Where a place is from the page `shown` (the CFI of its text): negative before it, 0 on it, positive after it or when either cannot be read. */
    fromPage(cfi: string, shown: string): number
}

interface Read {
    start: unknown
    end: unknown
}

export const createPlaces = (cfis: CfiReader): Places => {
    const read = (cfi: string): Read | null => {
        try {
            const parsed = cfis.parse(cfi)
            return { start: cfis.collapse(parsed), end: cfis.collapse(parsed, true) }
        } catch {
            return null
        }
    }
    const known = new Map<string, Read | null>()
    const place = (cfi: string): Read | null => {
        let found = known.get(cfi)
        if (found === undefined) known.set(cfi, found = read(cfi))
        return found
    }
    const order = (a: Read, b: Read): number => cfis.compare(a.start, b.start) || cfis.compare(a.end, b.end)
    // The page shown changes with every turn, so only the last is kept.
    let page: { cfi: string, start: Read, end: Read } | null = null
    const pageAt = (cfi: string): { start: Read, end: Read } | null => {
        if (page?.cfi === cfi) return page
        const shown = read(cfi)
        page = shown && { cfi, start: { start: shown.start, end: shown.start }, end: { start: shown.end, end: shown.end } }
        return page
    }
    return {
        compare(a, b) {
            const [first, second] = [place(a), place(b)]
            if (!first || !second) return Number(!first) - Number(!second)
            return order(first, second)
        },
        fromPage(cfi, shown) {
            const at = place(cfi)
            const on = pageAt(shown)
            if (!at || !on) return 1
            if (order(at, on.start) < 0) return -1
            return order(at, on.end) > 0 ? 1 : 0
        },
    }
}

/**
 * The section a place (a CFI) is in, worked out once for each section: the
 * part before the first `!` names it, and every place in a section shares it.
 */
export const createSectionOf = (resolve: (cfi: string) => number | null): (cfi: string) => number | null => {
    const known = new Map<string, number | null>()
    return cfi => {
        const end = cfi.indexOf('!')
        if (end < 0) return resolve(cfi)
        const section = cfi.slice(0, end)
        let found = known.get(section)
        if (found === undefined) known.set(section, found = resolve(cfi))
        return found
    }
}
