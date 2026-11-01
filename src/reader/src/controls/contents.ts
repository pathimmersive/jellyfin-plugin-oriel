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
    /** Where the entry starts: its page, else the percent of the book; empty when unknown. */
    where: string
    /** Whether this is the entry being read. */
    current: boolean
}

/**
 * The Contents panel's rows for a book's contents: every entry in order, each
 * sub-entry right after its parent and one level deeper. `fractionOf` gives
 * the fraction of the book where an entry's link leads, `currentHref` is
 * the link of the entry being read, and `pageOf`, when pages are shown and
 * counted, gives the page an entry's link leads to.
 */
export const contentsRows = (
    toc: TocEntry[],
    fractionOf: (href: string) => number | null,
    currentHref: string | null,
    pageOf: ((href: string) => number | null) | null = null,
): ContentsRow[] => {
    const rows: ContentsRow[] = []
    const visit = (entries: TocEntry[], depth: number): void => {
        for (const entry of entries) {
            const href = entry.href ?? ''
            const fraction = href ? fractionOf(href) : null
            const page = href && pageOf ? pageOf(href) : null
            rows.push({
                label: (entry.label ?? '').trim(),
                href,
                depth,
                where: page !== null ? String(page) : fraction === null ? '' : `${Math.round(fraction * 100)}%`,
                current: !!href && href === currentHref,
            })
            if (entry.subitems?.length) visit(entry.subitems, depth + 1)
        }
    }
    visit(toc, 0)
    return rows
}
