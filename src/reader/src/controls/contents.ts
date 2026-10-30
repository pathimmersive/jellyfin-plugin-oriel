/** An entry of a book's contents, as foliate-js gives it. */
export interface TocEntry {
    label?: string
    href?: string
    subitems?: TocEntry[] | null
}

/** A row in the Contents panel. */
export interface ContentsRow {
    label: string
    /** Where the entry leads, or empty for an entry with no link. */
    href: string
    /** 0 for a top-level entry, one more for each level below. */
    depth: number
    /** The percent of the book where the entry starts, or empty when unknown. */
    percent: string
    /** Whether this is the entry being read. */
    current: boolean
}

/**
 * The Contents panel's rows for a book's contents: every entry in order, each
 * sub-entry right after its parent and one level deeper. `fractionOf` gives
 * the fraction of the book where an entry's link leads, and `currentHref` is
 * the link of the entry being read.
 */
export const contentsRows = (
    toc: TocEntry[],
    fractionOf: (href: string) => number | null,
    currentHref: string | null,
): ContentsRow[] => {
    const rows: ContentsRow[] = []
    const visit = (entries: TocEntry[], depth: number): void => {
        for (const entry of entries) {
            const href = entry.href ?? ''
            const fraction = href ? fractionOf(href) : null
            rows.push({
                label: (entry.label ?? '').trim(),
                href,
                depth,
                percent: fraction === null ? '' : `${Math.round(fraction * 100)}%`,
                current: !!href && href === currentHref,
            })
            if (entry.subitems?.length) visit(entry.subitems, depth + 1)
        }
    }
    visit(toc, 0)
    return rows
}
