import type { PageTurn } from '../settings/settings'

/** Which hint shows: tap zones on a touch screen, the Turning pages dialog on a desktop, or the Scroll zones. */
export type HintKind = 'touch' | 'desktop' | 'scroll'

/** The hints this device has dismissed: the first one, and the Scroll one. */
export interface HintsSeen {
    first: boolean
    scroll: boolean
}

const KEY = 'oriel-hints'

/** The hint for the page turn and the screen: `coarse` is a touch screen's pointer. */
export const hintKind = (pageTurn: PageTurn, coarse: boolean): HintKind =>
    pageTurn === 'scroll' ? 'scroll' : coarse ? 'touch' : 'desktop'

/** What this device has dismissed; storage it cannot read counts as nothing seen. */
export const readHintsSeen = (storage: Pick<Storage, 'getItem'>): HintsSeen => {
    try {
        const stored: unknown = JSON.parse(storage.getItem(KEY) ?? '{}')
        const seen = (stored && typeof stored === 'object' ? stored : {}) as Partial<Record<keyof HintsSeen, unknown>>
        return { first: seen.first === true, scroll: seen.scroll === true }
    } catch {
        return { first: false, scroll: false }
    }
}

/** Remembers that the hint `kind` was dismissed; the Scroll hint counts as the first one too. */
export const sawHint = (storage: Pick<Storage, 'getItem' | 'setItem'>, kind: HintKind): void => {
    const seen = readHintsSeen(storage)
    const next = { first: true, scroll: seen.scroll || kind === 'scroll' }
    try {
        storage.setItem(KEY, JSON.stringify(next))
    } catch {
        // Private browsing or a full store: the hint shows again next time.
    }
}

/** The reader's last input, as the hint reads it. */
export interface LastInput {
    /** Listens for input in `win`: this page, or a section document of the book. */
    watch(win: Pick<Window, 'addEventListener'>): void
    /** True when the reader last touched the screen; before any input, `coarse` (the primary pointer) decides. */
    touch(): boolean
}

/**
 * Follows the input the reader last used, so a device with both touch and a
 * mouse or trackpad teaches the gestures in use: a touch, or a mouse, trackpad
 * or key. A pen leaves it as it was.
 */
export const lastInput = (coarse: () => boolean): LastInput => {
    let touched: boolean | null = null
    return {
        watch(win) {
            const options = { capture: true, passive: true }
            win.addEventListener('pointerdown', event => {
                if (event.pointerType === 'touch') touched = true
                else if (event.pointerType === 'mouse') touched = false
            }, options)
            win.addEventListener('touchstart', () => { touched = true }, options)
            win.addEventListener('keydown', () => { touched = false }, options)
            win.addEventListener('wheel', () => { touched = false }, options)
        },
        touch: () => touched ?? coarse(),
    }
}

/**
 * Whether a hint shows by itself: on opening a book, until this device has
 * dismissed one; on choosing Scroll, until it has dismissed the Scroll hint.
 */
export const hintDue = (seen: HintsSeen, moment: 'open' | 'scroll'): boolean =>
    moment === 'open' ? !seen.first : !seen.scroll

// Material icons, as the canvas draws them.
const ICONS = {
    prev: 'M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z',
    next: 'M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z',
    menu: 'M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z',
    up: 'M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6 1.41 1.41z',
    down: 'M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z',
}

const ZONES: Record<'touch' | 'scroll', [string, string][]> = {
    touch: [['Previous page', ICONS.prev], ['Show the controls', ICONS.menu], ['Next page', ICONS.next]],
    scroll: [['Scroll up a screen', ICONS.up], ['Show the controls', ICONS.menu], ['Scroll down a screen', ICONS.down]],
}

/** The line under the zones. */
export const hintLine = (kind: 'touch' | 'scroll', coarse: boolean): string =>
    kind === 'touch' ? 'Or swipe left and right to turn pages.'
        : coarse ? 'Or drag up and down to scroll freely.' : 'Or use the mouse wheel or arrow keys to scroll freely.'

// The desktop's tiles, as the canvas draws them: caption, description and drawing.
const STROKE = 'fill="none" stroke="rgba(255,255,255,.87)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"'
const TILES: [string, string, string][] = [
    ['Arrow keys or Space', 'The left and right arrow keys, or Space, turn the page',
        '<rect x="38" y="8" width="52" height="46" rx="8"/><path d="M72 31H56M63 23l-8 8 8 8"/><rect x="110" y="8" width="52" height="46" rx="8"/><path d="M128 31h16M137 23l8 8-8 8"/><rect x="38" y="66" width="124" height="34" rx="8"/><path d="M80 88v4h40v-4" stroke="rgba(255,255,255,.6)"/>'],
    ['Mouse wheel', 'Scrolling the mouse wheel turns the page',
        '<rect x="62" y="10" width="54" height="90" rx="27"/><path d="M89 10v32M62 42h54"/><rect x="85" y="20" width="8" height="14" rx="4" fill="#00a4dc" stroke="#00a4dc"/><path d="M138 30l8-10 8 10M138 80l8 10 8-10M146 22v66" stroke="#00a4dc"/>'],
    ['Two-finger swipe', 'A two-finger swipe on a trackpad turns the page',
        '<rect x="30" y="12" width="140" height="86" rx="10"/><circle cx="90" cy="48" r="9" fill="rgba(255,255,255,.2)"/><circle cx="112" cy="48" r="9" fill="rgba(255,255,255,.2)"/><path d="M58 76h84M66 68l-8 8 8 8M134 68l8 8-8 8" stroke="#00a4dc"/>'],
    ['Click an edge - the middle shows the controls', 'Clicking the left or right edge turns the page; clicking the middle shows the controls',
        '<rect x="30" y="10" width="140" height="90" rx="6"/><path d="M66 10v90M134 10v90" stroke-dasharray="5 5" stroke="rgba(255,255,255,.5)"/><path d="M52 47l-8 8 8 8M148 47l8 8-8 8" stroke="#00a4dc"/><path d="M88 46h24M88 55h24M88 64h24"/><path d="M150 72l14 30 4-12 12-4z" fill="#202020"/>'],
]

/** The hint over the page, as the page shows it. */
export interface Hint {
    /** Shows the hint `kind` over everything, with Got it focused. */
    show(kind: HintKind): void
    /** Closes it, as Got it does. */
    close(): void
    readonly shown: boolean
}

/**
 * Adds the reading gestures hint to `root`, hidden. `coarse` tells a touch
 * screen; `dismissed` is told which hint Got it or Escape closed.
 */
export const createHint = (root: HTMLElement, coarse: () => boolean, dismissed: (kind: HintKind) => void): Hint => {
    const overlay = document.createElement('div')
    overlay.id = 'hint'
    overlay.setAttribute('data-controls', '')
    overlay.hidden = true
    root.append(overlay)
    let shownKind: HintKind | null = null

    const gotIt = (): HTMLButtonElement => {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'got-it'
        button.textContent = 'Got it'
        button.addEventListener('click', () => hint.close())
        return button
    }

    const zonesHint = (kind: 'touch' | 'scroll'): HTMLElement => {
        const dialog = document.createElement('div')
        dialog.className = `zones-hint ${kind}`
        dialog.setAttribute('role', 'dialog')
        dialog.setAttribute('aria-modal', 'true')
        dialog.setAttribute('aria-label', 'Reading gestures')
        const grid = document.createElement('div')
        grid.className = 'zones'
        for (const [name, path] of ZONES[kind]) {
            const zone = document.createElement('div')
            zone.className = 'zone'
            zone.innerHTML = `<svg aria-hidden="true" width="32" height="32" viewBox="0 0 24 24" fill="#fff"><path d="${path}"/></svg><span></span>`
            zone.querySelector('span')!.textContent = name
            grid.append(zone)
        }
        const foot = document.createElement('div')
        foot.className = 'hint-foot'
        const line = document.createElement('p')
        line.className = 'hint-line'
        line.textContent = hintLine(kind, coarse())
        foot.append(line, gotIt())
        dialog.append(grid, foot)
        return dialog
    }

    const desktopHint = (): HTMLElement => {
        const dialog = document.createElement('div')
        dialog.className = 'desktop-hint'
        dialog.setAttribute('role', 'dialog')
        dialog.setAttribute('aria-modal', 'true')
        dialog.setAttribute('aria-label', 'Turning pages')
        const heading = document.createElement('h2')
        heading.textContent = 'Turning pages'
        const tiles = document.createElement('div')
        tiles.className = 'tiles'
        for (const [caption, description, drawing] of TILES) {
            const tile = document.createElement('div')
            tile.className = 'tile'
            tile.setAttribute('role', 'img')
            tile.setAttribute('aria-label', description)
            tile.innerHTML = `<svg aria-hidden="true" width="200" height="110" viewBox="0 0 200 110" ${STROKE}>${drawing}</svg><span aria-hidden="true"></span>`
            tile.querySelector('span')!.textContent = caption
            tiles.append(tile)
        }
        dialog.append(heading, tiles, gotIt())
        return dialog
    }

    const hint: Hint = {
        show(kind) {
            shownKind = kind
            overlay.replaceChildren(kind === 'desktop' ? desktopHint() : zonesHint(kind))
            overlay.hidden = false
            overlay.querySelector<HTMLButtonElement>('.got-it')!.focus()
        },
        close() {
            if (!shownKind) return
            const kind = shownKind
            shownKind = null
            overlay.hidden = true
            overlay.replaceChildren()
            dismissed(kind)
        },
        get shown() {
            return shownKind !== null
        },
    }
    return hint
}
