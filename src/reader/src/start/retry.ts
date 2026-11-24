import { type Failure, failureFor } from '../controls/failure'

// Resolves when it is time to ask an unreachable server again: after 5
// seconds, when the browser comes back online, or on Try again.
const untilRetry = (): { retry: () => void, due: Promise<void> } => {
    let retry = (): void => {}
    const due = new Promise<void>(resolve => {
        const timer = window.setTimeout(() => retry(), 5000)
        retry = () => {
            clearTimeout(timer)
            window.removeEventListener('online', retry)
            resolve()
        }
        window.addEventListener('online', retry)
    })
    return { retry, due }
}

/**
 * What `ask` gets from the server. While the server cannot be reached,
 * `offline` says so and it is asked again until it answers; any other failure
 * is thrown.
 */
export const untilReached = async <T>(ask: () => Promise<T>, offline: (failure: Failure, retry: () => void) => void): Promise<T> => {
    for (;;) {
        try {
            return await ask()
        } catch (error) {
            const failure = failureFor(error, 'downloaded')
            if (failure === 'signIn' || failure.kind !== 'offline') throw error
            const { retry, due } = untilRetry()
            offline(failure, retry)
            await due
        }
    }
}
