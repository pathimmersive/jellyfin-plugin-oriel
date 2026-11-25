import { afterEach, describe, expect, it, vi } from 'vitest'
import { columnLayout, countPages, type Resolve } from '../src/engine/pages'

// Boxes as a browser reports them, with only the sides the layout reads.
const box = (left: number, top: number, right = left, bottom = top): DOMRect => ({ left, top, right, bottom } as DOMRect)

/**
 * A section document as the layout measures it: the root at (rootLeft, rootTop),
 * the body's content ending at `contentRight` across or `contentBottom` down,
 * and columns `columnWidth` wide with `columnGap` between them.
 */
const sectionDoc = ({ rootLeft = 0, rootTop = 0, contentRight = 0, contentBottom = 0, columnWidth = 300, columnGap = 40 } = {}): Document => ({
    documentElement: { getBoundingClientRect: () => box(rootLeft, rootTop) },
    body: {},
    createRange: () => ({ selectNodeContents: () => {}, getBoundingClientRect: () => box(rootLeft, rootTop, contentRight, contentBottom) }),
    defaultView: { getComputedStyle: () => ({ columnWidth: `${columnWidth}px`, columnGap: `${columnGap}px` }) },
    fonts: { ready: Promise.resolve() },
} as unknown as Document)

// An element whose box starts at (left, top).
const element = (left: number, top: number): Element => ({ getBoundingClientRect: () => box(left, top) } as unknown as Element)

// A range whose first line starts at (left, top).
const range = (left: number, top: number): Range => ({ collapsed: false, getClientRects: () => [box(left, top)] } as unknown as Range)

describe('columnLayout', () => {
    it('counts a section\'s columns on a narrow screen, one column a screen', () => {
        // 340 wide, one 300 column and its 40 gap a screen; content to 1,700: five columns.
        const layout = columnLayout(sectionDoc({ contentRight: 1700 }), 340)
        expect(layout.perScreen).toBe(1)
        expect(layout.columns).toBe(5)
    })

    it('counts two columns a screen on a wide one', () => {
        const layout = columnLayout(sectionDoc({ contentRight: 2040 }), 680)
        expect(layout.perScreen).toBe(2)
        expect(layout.columns).toBe(6)
    })

    it('does not count a column for content that ends a hair past a column\'s edge', () => {
        // Sub-pixel overflow, as fonts and zoom leave it, is not a column of its own.
        expect(columnLayout(sectionDoc({ contentRight: 1700.5 }), 340).columns).toBe(5)
        expect(columnLayout(sectionDoc({ contentRight: 1710 }), 340).columns).toBe(6)
    })

    it('gives an empty section one column', () => {
        expect(columnLayout(sectionDoc({ contentRight: 0 }), 340).columns).toBe(1)
    })

    it('measures from the root, wherever the frame puts it', () => {
        const layout = columnLayout(sectionDoc({ rootLeft: -680, contentRight: 1020 }), 340)
        expect(layout.columns).toBe(5)
        expect(layout.place(element(-680 + 2 * 340 + 12, 0)).column).toBe(2)
    })

    it('places an element or a range in the column it starts in, and says whether it starts at the top', () => {
        const layout = columnLayout(sectionDoc({ contentRight: 1700 }), 340)
        expect(layout.place(element(0, 0))).toEqual({ column: 0, atTop: true })
        expect(layout.place(element(700, 0.5))).toEqual({ column: 2, atTop: true })
        expect(layout.place(range(1400, 220))).toEqual({ column: 4, atTop: false })
        expect(layout.place(element(-5, 0)).column).toBe(0)
    })

    it('cuts a scrolled section into screens, and places by height', () => {
        // 800 tall screens, content 3,000 down: four screens.
        const layout = columnLayout(sectionDoc({ rootTop: 10, contentBottom: 3010 }), 800, true)
        expect(layout).toMatchObject({ perScreen: 1, columns: 4 })
        expect(layout.place(element(0, 10))).toEqual({ column: 0, atTop: true })
        expect(layout.place(element(0, 10 + 1600))).toEqual({ column: 2, atTop: true })
        expect(layout.place(range(0, 10 + 1700))).toEqual({ column: 2, atTop: false })
    })
})

describe('countPages', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    // The hidden paginator: shows each section's document, as foliate-js's does, and records what happens to it.
    const setUp = (docs: (Document | null)[], options: { flow?: string } = {}) => {
        const events: string[] = []
        const added: { removed: boolean }[] = []
        let shown = -1
        const counter = {
            size: 340,
            attributes: new Map<string, string>(),
            setAttribute(name: string, value: string) { this.attributes.set(name, value) },
            getAttribute(name: string) { return this.attributes.get(name) ?? null },
            open(book: { sections: { unload?(): void }[] }) { this.book = book },
            book: null as { sections: { unload?(): void }[] } | null,
            setStyles(styles: string) { events.push(`styles ${styles}`) },
            async goTo({ index }: { index: number }) {
                if (shown >= 0) this.book!.sections[shown].unload?.()
                shown = index
                events.push(`show ${index}`)
            },
            getContents() { return docs[shown] ? [{ doc: docs[shown]!, index: shown }] : [] },
            destroy() { events.push('destroy') },
        }
        vi.stubGlobal('document', {
            createElement: (name: string) => {
                if (name === 'foliate-paginator') return counter
                const host = { style: {}, removed: false, setAttribute: () => {}, append: () => {}, remove() { this.removed = true } }
                added.push(host)
                return host
            },
            body: { append: () => {} },
        })
        vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, 0))
        const shownOnScreen = {
            getBoundingClientRect: () => box(0, 0, 340, 600),
            getAttribute: (name: string) => (name === 'flow' ? options.flow ?? 'paginated' : name === 'gap' ? '7%' : null),
        } as unknown as HTMLElement
        return { events, added, counter, shownOnScreen }
    }

    const unloads: number[] = []
    const sections = (count: number, nonLinear: number[] = []) => Array.from({ length: count }, (_, index) => ({
        load: () => `section ${index}`,
        unload: () => { unloads.push(index) },
        linear: nonLinear.includes(index) ? 'no' : undefined,
    }))

    it('counts each section\'s columns, gives each place the page it starts on, and cleans up', async () => {
        unloads.length = 0
        const docs = [sectionDoc({ contentRight: 680 }), sectionDoc({ contentRight: 1020 }), sectionDoc({ contentRight: 340 })]
        const { events, added, counter, shownOnScreen } = setUp(docs)
        // Chapter Two's link names the section; its nested entry names an element in its third column.
        const resolve: Resolve = href => ({
            'ch2.xhtml': { index: 1 },
            'ch2.xhtml#half': { index: 1, anchor: () => element(700, 0) },
            'ch3.xhtml': { index: 2, anchor: () => null },
        })[href] ?? null

        const count = await countPages(shownOnScreen, { sections: sections(3) }, 'styles here', ['ch2.xhtml', 'ch2.xhtml#half', 'ch3.xhtml', 'missing.xhtml'], href => resolve(href)?.index ?? null, resolve, () => 1, () => false)

        expect(count).toEqual({ sections: [2, 3, 1], entries: { 'ch2.xhtml': 3, 'ch2.xhtml#half': 5, 'ch3.xhtml': 6 } })
        expect(counter.attributes.get('flow')).toBe('paginated')
        expect(counter.attributes.get('gap')).toBe('7%')
        expect(events).toEqual(['styles styles here', 'show 0', 'show 1', 'show 2', 'destroy'])
        expect(added.every(host => host.removed)).toBe(true)
        // Sections left behind are unloaded; the one the reader shows (1) is not.
        expect(unloads).toEqual([0])
    })

    it('resolves only the places of the sections it reaches, each as it reaches its section', async () => {
        const docs = [sectionDoc({ contentRight: 340 }), sectionDoc({ contentRight: 340 })]
        const { events, shownOnScreen } = setUp(docs)
        const resolve: Resolve = href => {
            events.push(`resolve ${href}`)
            return { index: href === 'a' ? 0 : 1, anchor: () => element(0, 0) }
        }

        await countPages(shownOnScreen, { sections: sections(2) }, '', ['b', 'nowhere', 'a'], href => ({ a: 0, b: 1 })[href] ?? null, resolve, () => -1, () => false)

        expect(events).toEqual(['styles ', 'show 0', 'resolve a', 'show 1', 'resolve b', 'destroy'])
    })

    it('gives a section the reader pages past, or one that shows nothing, no pages', async () => {
        const docs = [sectionDoc({ contentRight: 680 }), sectionDoc({ contentRight: 3400 }), null]
        const { shownOnScreen } = setUp(docs)

        const count = await countPages(shownOnScreen, { sections: sections(3, [1]) }, '', [], () => null, () => null, () => -1, () => false)

        expect(count).toEqual({ sections: [2, 0, 0], entries: {} })
    })

    it('counts a scrolled book in screens', async () => {
        const doc = sectionDoc({ contentBottom: 1500 })
        const { counter, shownOnScreen } = setUp([doc], { flow: 'scrolled' })
        counter.size = 600

        expect(await countPages(shownOnScreen, { sections: sections(1) }, '', [], () => null, () => null, () => -1, () => false)).toEqual({ sections: [3], entries: {} })
    })

    it('stops and gives nothing once cancelled, removing what it added', async () => {
        const docs = [sectionDoc({ contentRight: 680 }), sectionDoc({ contentRight: 680 })]
        const { events, added, shownOnScreen } = setUp(docs)
        let asked = 0

        const count = await countPages(shownOnScreen, { sections: sections(2) }, '', [], () => null, () => null, () => -1, () => ++asked > 2)

        expect(count).toBeNull()
        expect(events).toEqual(['styles ', 'show 0', 'destroy'])
        expect(added.every(host => host.removed)).toBe(true)
    })

    it('destroys no paginator that never showed a section', async () => {
        const { events, added, shownOnScreen } = setUp([sectionDoc()])

        expect(await countPages(shownOnScreen, { sections: sections(1) }, '', [], () => null, () => null, () => -1, () => true)).toBeNull()
        expect(events).toEqual(['styles '])
        expect(added.every(host => host.removed)).toBe(true)
    })
})
