/** The session, as the server's answers show it. */
export interface SessionWatch {
    /** `fetch`, noticing an answer that the session has ended. */
    fetch: typeof fetch
    /** Calls `ended` once, when the session has ended, or at once if it already has. */
    onEnded(ended: () => void): void
}

/** Watches every answer for a 401: the session has ended, and nothing more will be read or saved. */
export const watchSession = (ask: typeof fetch = fetch): SessionWatch => {
    let over = false
    let tell: (() => void) | null = null
    return {
        fetch: async (input, init) => {
            const response = await ask(input, init)
            if (response.status === 401 && !over) {
                over = true
                tell?.()
            }
            return response
        },
        onEnded(ended) {
            tell = ended
            if (over) ended()
        },
    }
}
