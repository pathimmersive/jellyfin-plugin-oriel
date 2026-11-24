import { type Highlighter, type HighlighterEdit, moved } from './highlighters'

const asEdit = ({ id, name, solid }: Highlighter): HighlighterEdit => ({ id, name, colour: solid })

/** Where an arrow key moves the highlighter at `index` of `length`; null for another key, or past an end. */
export const keyTarget = (key: string, index: number, length: number): number | null => {
    const to = key === 'ArrowUp' ? index - 1 : key === 'ArrowDown' ? index + 1 : -1
    return to < 0 || to >= length ? null : to
}

/** Where a highlighter dropped at `y` lands, from the middles of the other rows. */
export const dropTarget = (middles: readonly number[], y: number): number =>
    middles.filter(middle => y > middle).length

/** The whole list to keep with the one at `from` moved to `to`; null when that is where it is. */
export const reordered = (list: readonly Highlighter[], from: number, to: number): HighlighterEdit[] | null =>
    from === to ? null : moved(list, from, to).map(asEdit)

/** The whole list to keep without the highlighter `id`. */
export const without = (list: readonly Highlighter[], id: string): HighlighterEdit[] =>
    list.filter(highlighter => highlighter.id !== id).map(asEdit)
