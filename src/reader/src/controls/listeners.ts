/** The listeners a store tells when what it keeps changes. */
export interface Listeners {
    /** Adds a listener. */
    on: (listener: () => void) => void
    /** Calls every listener, in the order they were added. */
    tell: () => void
}

export const createListeners = (): Listeners => {
    const listeners: (() => void)[] = []
    return {
        on: listener => { listeners.push(listener) },
        tell: () => { for (const listener of listeners) listener() },
    }
}
