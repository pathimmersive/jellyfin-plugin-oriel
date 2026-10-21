import { frameStats, LONG_FRAME_MS } from './frames'

// How long to keep sampling frames after a page turn settles, to catch late layout work.
const SETTLE_MS = 300

/**
 * A small timing panel for checking the reader on devices without developer
 * tools. Shown only when the page is opened with ?debug=1.
 */
export class DebugOverlay {
    readonly #element: HTMLElement
    readonly #lines = new Map<string, string>()

    constructor(parent: HTMLElement) {
        this.#element = document.createElement('pre')
        this.#element.id = 'debug'
        parent.append(this.#element)
    }

    set(key: string, text: string): void {
        this.#lines.set(key, text)
        this.#element.textContent = [...this.#lines.values()].join('\n')
    }

    /**
     * Times each page turn on a foliate-js view: from the end of the touch to
     * the view's next relocate, with the frame statistics up to SETTLE_MS later.
     * Touches land in each section's own document, so listen on every loaded one.
     */
    timeTurns(view: EventTarget): void {
        let turnStart: number | null = null
        let frames: number[] = []
        let sampling = false

        const sample = (time: number) => {
            frames.push(time)
            if (sampling) requestAnimationFrame(sample)
        }

        const onTouchEnd = () => {
            turnStart = performance.now()
            frames = [turnStart]
            if (!sampling) {
                sampling = true
                requestAnimationFrame(sample)
            }
        }

        view.addEventListener('touchend', onTouchEnd)
        view.addEventListener('load', event => {
            const { doc } = (event as CustomEvent<{ doc: Document }>).detail
            doc.addEventListener('touchend', onTouchEnd)
        })
        view.addEventListener('relocate', () => {
            if (turnStart === null) return
            const turnMs = Math.round(performance.now() - turnStart)
            turnStart = null
            setTimeout(() => {
                sampling = false
                const { longFrames, worstFrame } = frameStats(frames)
                this.set('turn', `last turn ${turnMs} ms · ${longFrames} frames > ${LONG_FRAME_MS} ms · worst frame ${worstFrame} ms`)
            }, SETTLE_MS)
        })
    }
}
