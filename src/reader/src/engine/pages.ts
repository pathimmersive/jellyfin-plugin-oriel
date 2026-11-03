// Pages as foliate-js's paginator lays them out: one column of text is a page.
import type { PageCount } from '../controls/progress'

/**
 * A section document laid out in columns, as the paginator lays it out on a
 * screen `size` wide; or, `scrolled`, as one column cut into screens `size` tall.
 */
export interface ColumnLayout {
    /** Columns side by side on one screen: 1, or 2 on a wide one. */
    perScreen: number
    /** The section's columns of text. */
    columns: number
    /** The column an element or range starts in (from 0), and whether it starts at the column's top. */
    place(target: Element | Range): { column: number, atTop: boolean }
}

/**
 * Where a target starts on screen. An element's box; a range's first line, or,
 * for a collapsed range (a place, as a bookmark keeps it), the first character
 * shown after it, since Chromium gives a collapsed range an empty box at the
 * frame's corner.
 */
const startRect = (target: Element | Range): DOMRect => {
    if (!('collapsed' in target)) return target.getBoundingClientRect()
    const [first] = target.getClientRects()
    if (first) return first
    const doc = target.startContainer.ownerDocument
    let node: Node | null = target.startContainer
    let offset = target.startOffset
    if (node.nodeType !== Node.TEXT_NODE) {
        node = node.childNodes[offset] ?? null
        offset = 0
    }
    if (doc?.body && node) {
        const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
        walker.currentNode = node
        for (let text = node.nodeType === Node.TEXT_NODE ? node as Text : walker.nextNode() as Text | null; text; text = walker.nextNode() as Text | null, offset = 0) {
            const at = text.data.slice(offset).search(/\S/)
            if (at < 0) continue
            const character = doc.createRange()
            character.setStart(text, offset + at)
            character.setEnd(text, offset + at + 1)
            const [rect] = character.getClientRects()
            if (rect) return rect
        }
    }
    return target.getBoundingClientRect()
}

export const columnLayout = (doc: Document, size: number, scrolled = false): ColumnLayout => {
    const root = doc.documentElement
    if (scrolled) {
        const top = root.getBoundingClientRect().top
        const content = doc.createRange()
        content.selectNodeContents(doc.body)
        return {
            perScreen: 1,
            columns: Math.max(1, Math.ceil((content.getBoundingClientRect().bottom - top) / size - 0.01)),
            place(target) {
                const offset = startRect(target).top - top
                const column = Math.max(0, Math.floor(offset / size))
                return { column, atTop: offset - column * size <= 1 }
            },
        }
    }
    const style = doc.defaultView!.getComputedStyle(root)
    const perScreen = Math.max(1, Math.round(size / (parseFloat(style.columnWidth) + parseFloat(style.columnGap))))
    const slot = size / perScreen
    const rootRect = root.getBoundingClientRect()
    // As the paginator measures it: from the root's start to the end of the body's content.
    const range = doc.createRange()
    range.selectNodeContents(doc.body)
    const columns = Math.max(1, Math.ceil((range.getBoundingClientRect().right - rootRect.left) / slot - 0.01))
    return {
        perScreen,
        columns,
        place(target) {
            const rect = startRect(target)
            return { column: Math.max(0, Math.floor((rect.left - rootRect.left) / slot)), atTop: rect.top - rootRect.top <= 1 }
        },
    }
}

/** What a contents link leads to: its section, and in it the element or range it names, if any. */
export type Resolve = (href: string) => { index: number, anchor?: (doc: Document) => Element | Range | null } | null

/** A book section as foliate-js gives it. */
interface Section {
    load(): Promise<string> | string
    unload?(): void
    linear?: string
}

interface Paginator extends HTMLElement {
    open(book: { dir?: string, sections: Section[] }): void
    goTo(target: { index: number }): Promise<void>
    setStyles(styles: string): void
    getContents(): { doc: Document, index: number }[]
    destroy(): void
    readonly size: number
}

/**
 * Counts every section's pages by laying the book out again in a hidden
 * paginator the size of `shown` (the paginator on screen), with the same gap
 * and `styles`, one section at a time. `hrefs` are the contents links and
 * any other places (CFIs), each given the page it starts on. `showing` is the section on screen, which the
 * count leaves loaded. Returns null when `cancelled` turns true first.
 */
export const countPages = async (
    shown: HTMLElement,
    book: { dir?: string, sections: Section[] },
    styles: string,
    hrefs: string[],
    resolve: Resolve,
    showing: () => number,
    cancelled: () => boolean,
): Promise<PageCount | null> => {
    const box = shown.getBoundingClientRect()
    const host = document.createElement('div')
    host.setAttribute('aria-hidden', 'true')
    Object.assign(host.style, {
        position: 'fixed', left: '0', top: '0', width: `${box.width}px`, height: `${box.height}px`,
        visibility: 'hidden', pointerEvents: 'none', overflow: 'hidden', zIndex: '-1',
    })
    const counter = document.createElement('foliate-paginator') as Paginator
    for (const name of ['flow', 'margin', 'gap', 'max-inline-size', 'max-column-count']) {
        const value = shown.getAttribute(name)
        if (value !== null) counter.setAttribute(name, value)
    }
    // The sections the reader is not showing are unloaded as the count moves on.
    const sections = book.sections.map((section, index): Section => ({
        ...section,
        unload: () => { if (index !== showing()) section.unload?.() },
    }))
    counter.open({ dir: book.dir, sections })
    counter.setStyles(styles)
    host.append(counter)
    document.body.append(host)

    const links = hrefs.map(href => ({ href, target: resolve(href) }))
    const pages: number[] = []
    const entries: Record<string, number> = {}
    let before = 0
    try {
        for (let index = 0; index < sections.length; index++) {
            if (cancelled()) return null
            // A section the reader pages past (non-linear) has no pages of its own.
            if (sections[index].linear === 'no') {
                pages.push(0)
                continue
            }
            await counter.goTo({ index })
            const doc = counter.getContents()[0]?.doc
            if (!doc) {
                pages.push(0)
                continue
            }
            await doc.fonts.ready
            await new Promise(resolve => requestAnimationFrame(resolve))
            if (cancelled()) return null
            const layout = columnLayout(doc, counter.size, counter.getAttribute('flow') === 'scrolled')
            for (const { href, target } of links) {
                if (target?.index !== index) continue
                const node = target.anchor?.(doc)
                entries[href] = before + (node ? layout.place(node).column : 0) + 1
            }
            pages.push(layout.columns)
            before += layout.columns
        }
        return { sections: pages, entries }
    } finally {
        // A paginator that never showed a section has nothing to destroy.
        if (pages.length) counter.destroy()
        host.remove()
    }
}
