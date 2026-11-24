/** What Escape can close, each over the ones after it. */
export interface EscapeTargets {
    /** The reading gestures hint. */
    hint: { readonly shown: boolean, close(): void }
    /** The dialog Reset to defaults asks in. */
    reset: { readonly shown: boolean, close(): void }
    /** The dialog deleting a highlighter asks in. */
    highlighter: { readonly shown: boolean, close(): void }
    /** Closes the dialog Delete theme asks in; false when it was not open. */
    theme(): boolean
    /** More, Contents, Preferences and Search. */
    panels: { readonly shown: boolean, close(): void }
}

/** Closes what Escape closes: the first of `targets` that is open, and nothing else. */
export const closeOnEscape = (targets: EscapeTargets) => (event: Pick<KeyboardEvent, 'key' | 'preventDefault'>): void => {
    if (event.key !== 'Escape') return
    if (targets.hint.shown) targets.hint.close()
    else if (targets.reset.shown) targets.reset.close()
    else if (targets.highlighter.shown) targets.highlighter.close()
    else if (targets.theme()) return
    else if (targets.panels.shown) {
        // Escape in the search field would also clear it; the search stays for next time.
        event.preventDefault()
        targets.panels.close()
    }
}
