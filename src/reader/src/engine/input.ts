// Desktop page turns: the keys, edge clicks and wheel gestures that turn a
// page, as plain rules, and a function that wires them to a document.

/** A page turn: in reading order (next, prev) or on screen (left, right). */
export type Turn = 'next' | 'prev' | 'left' | 'right'

/** The parts of a key event the rules read. */
export interface KeyInput {
    key: string
    shiftKey: boolean
    ctrlKey: boolean
    altKey: boolean
    metaKey: boolean
}

/**
 * The turn a key asks for, or null to leave it to the browser: a key with
 * Ctrl, Alt or Meta is a browser shortcut, and Shift with an arrow extends a
 * selection.
 */
export const keyTurn = (event: KeyInput): Turn | null => {
    if (event.ctrlKey || event.altKey || event.metaKey) return null
    switch (event.key) {
        case 'ArrowRight': return event.shiftKey ? null : 'right'
        case 'ArrowLeft': return event.shiftKey ? null : 'left'
        case ' ': return event.shiftKey ? 'prev' : 'next'
        case 'PageDown': return 'next'
        case 'PageUp': return 'prev'
        default: return null
    }
}

/** The share of the page's width on each side where a mouse click turns the page. */
export const EDGE = 0.22
/** The share on each side where a tap on a touch screen turns the page. */
export const TOUCH_EDGE = 0.3

/**
 * What a click at `x` on a page `width` wide starting at `left` asks for: the
 * outer 22% on each side turn left or right (30% for a tap on a touch screen)
 * and the middle shows or hides the reader's controls ('menu'). Anywhere
 * outside the page asks for nothing.
 */
export const clickTarget = (x: number, left: number, width: number, touch: boolean): Turn | 'menu' | null => {
    if (width <= 0) return null
    const share = (x - left) / width
    if (share < 0 || share > 1) return null
    const edge = touch ? TOUCH_EDGE : EDGE
    if (share < edge) return 'left'
    if (share > 1 - edge) return 'right'
    return 'menu'
}

/** Wheel events further apart than this start a new gesture. */
export const GESTURE_GAP_MS = 250
/** How far a gesture must move, in pixels, before it turns the page. */
export const WHEEL_THRESHOLD = 24

/** The parts of a wheel event the rules read. */
export interface WheelInput {
    deltaX: number
    deltaY: number
    deltaMode: number
}

// deltaMode 1 counts lines and 2 counts pages; turn both into pixels.
const PIXELS_PER_MODE = [1, 16, 800]

/**
 * Turns wheel events into at most one turn per gesture: a run of events with
 * no gap over 250 ms, which covers a trackpad's momentum. The gesture turns
 * once it has moved 24 pixels: down or up for next or prev, sideways for right
 * or left, as a touch swipe the same way would. One gesture serves every
 * section's document, timed by `now` rather than each document's own event
 * clock, so a swipe that carries into the next section still turns once.
 */
export const wheelGesture = (now: () => number = () => performance.now()): ((event: WheelInput) => Turn | null) => {
    let last = -Infinity
    let x = 0
    let y = 0
    let turned = false
    return event => {
        const time = now()
        if (time - last > GESTURE_GAP_MS) {
            x = 0
            y = 0
            turned = false
        }
        last = time
        if (turned) return null
        const scale = PIXELS_PER_MODE[event.deltaMode] ?? 1
        x += event.deltaX * scale
        y += event.deltaY * scale
        if (Math.max(Math.abs(x), Math.abs(y)) < WHEEL_THRESHOLD) return null
        turned = true
        if (Math.abs(x) > Math.abs(y)) return x > 0 ? 'right' : 'left'
        return y > 0 ? 'next' : 'prev'
    }
}

/** The parts of a document the input listens to. */
export interface PageDocument {
    defaultView: Pick<Window, 'addEventListener'> | null
    getSelection(): Pick<Selection, 'isCollapsed'> | null
}

/** How far the mouse or a finger may move between press and release and still be a click or tap. */
const CLICK_SLOP = 5
/** How long a finger may rest and still be a tap, in milliseconds. */
export const TAP_MS = 500

/**
 * Turns pages from `doc`'s keys, clicks and wheel. `area` gives the page's
 * left edge and width in `doc`'s coordinates; `gesture` is the wheel gesture
 * shared by every document; `turn` performs a turn and `menu` shows or hides
 * the controls, for a click in the middle. `swiped` is told of a one-finger
 * swipe, which the paginator turns on its own. A click on a link or a control, a
 * click after a drag, and a click that leaves text selected do neither; nor
 * does a key typed into an editable field. Handled keys and wheel events are
 * cancelled, so the browser does not also scroll.
 */
export const attachPageInput = (
    doc: PageDocument,
    area: () => { left: number, width: number } | null,
    gesture: (event: WheelInput) => Turn | null,
    turn: (turn: Turn) => void,
    menu: () => void,
    swiped: () => void = () => {},
): void => {
    const win = doc.defaultView
    if (!win) return
    win.addEventListener('keydown', event => {
        if (event.defaultPrevented || isEditable(event.target)) return
        const wanted = keyTurn(event)
        if (!wanted) return
        event.preventDefault()
        turn(wanted)
    })

    // A click or tap at `x` turns at the edges and shows the controls in the
    // middle, unless it lands on a link or a control or leaves text selected.
    const act = (target: EventTarget | null, x: number, touch: boolean): void => {
        if ((target as Partial<Element> | null)?.closest?.('a[href], button, input, [data-controls]')) return
        const selection = doc.getSelection()
        if (selection && !selection.isCollapsed) return
        const bounds = area()
        const wanted = bounds && clickTarget(x, bounds.left, bounds.width, touch)
        if (wanted === 'menu') menu()
        else if (wanted) turn(wanted)
    }

    // Mouse clicks. A tap also ends in a click, but iOS Safari does not send
    // one for a tap on plain text, so taps are read from touch events below
    // and their clicks are left alone.
    let down: { x: number, y: number } | null = null
    win.addEventListener('pointerdown', event => {
        down = event.button === 0 && event.pointerType !== 'touch' ? { x: event.clientX, y: event.clientY } : null
    })
    win.addEventListener('click', event => {
        const start = down
        down = null
        if (event.button !== 0 || event.defaultPrevented || !start) return
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP) return
        act(event.target, event.clientX, false)
    })

    // Taps: one finger, lifted within TAP_MS without moving. A longer press
    // selects text, and a move is a swipe, which the paginator turns.
    let touched: { x: number, y: number, time: number } | null = null
    win.addEventListener('touchstart', event => {
        const touch = event.touches.length === 1 ? event.touches[0] : null
        touched = touch ? { x: touch.clientX, y: touch.clientY, time: event.timeStamp } : null
    })
    win.addEventListener('touchend', event => {
        const start = touched
        touched = null
        const touch = event.changedTouches[0]
        if (!start || !touch) return
        if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > CLICK_SLOP) {
            // A drag that leaves text selected is a selection, not a swipe.
            const selection = doc.getSelection()
            if (!selection || selection.isCollapsed) swiped()
            return
        }
        if (event.timeStamp - start.time > TAP_MS) return
        act(event.target, touch.clientX, true)
    })

    win.addEventListener('wheel', event => {
        if (event.ctrlKey) return // pinch-zoom on a trackpad, and Ctrl+wheel zoom
        event.preventDefault()
        const wanted = gesture(event)
        if (wanted) turn(wanted)
    }, { passive: false })
}

const isEditable = (target: EventTarget | null): boolean => {
    const element = target as { isContentEditable?: boolean, tagName?: string } | null
    return !!element && (element.isContentEditable === true
        || element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT')
}
