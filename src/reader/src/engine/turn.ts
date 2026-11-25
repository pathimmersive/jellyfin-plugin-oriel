// How long a Fade turn takes to fade out, and again to fade back in.
const FADE_MS = 150

// Fades the book out, turns with `go`, and fades it back in.
const fade = async (view: { style: Pick<CSSStyleDeclaration, 'transition' | 'opacity'> }, go: () => Promise<unknown>): Promise<void> => {
    view.style.transition = `opacity ${FADE_MS}ms ease`
    view.style.opacity = '0'
    await new Promise(resolve => setTimeout(resolve, FADE_MS))
    try {
        await go()
    } finally {
        view.style.opacity = '1'
    }
}

/** Turns the page of `view` with `go`, fading when `fading`; a move that fails leaves the page where it was and is only logged. */
export const turnPage = (view: { style: Pick<CSSStyleDeclaration, 'transition' | 'opacity'> }, go: () => Promise<unknown>, fading: boolean): void => {
    (fading ? fade(view, go) : go()).catch((error: unknown) => console.error('Oriel: the page turn failed', error))
}
