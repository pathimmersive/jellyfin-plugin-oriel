import type { Choices, KeptChoices } from '../settings/settings'

/** The theme and font the reader has chosen, kept on the server so they follow the reader. */
export interface ChosenOnServer {
    /**
     * The server's choice to open with, or null to keep this device's: when
     * the server has none or cannot be reached, and when this device's choice
     * is newer because it has not been sent yet.
     */
    ready: Promise<KeptChoices | null>
    /** A choice made on this device: kept until the server has it, sent at once and again until it answers. */
    choose(choices: Choices): void
}

/** What the choices need: the server, this device's storage, and a wait between tries. */
export interface ChoicesSources {
    load(): Promise<KeptChoices | null>
    /** True once the server has the choice, or has refused it for good; false while it cannot be reached. */
    save(choices: Choices): Promise<boolean>
    storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
    wait(ms: number): Promise<void>
}

const UNSENT = 'oriel-choices-unsent'
const FIRST_RETRY = 2000
const LAST_RETRY = 60000

/**
 * The reader's theme and font on the server. `device` is this device's last
 * choice: one not sent yet is sent instead of the server's being taken.
 */
export const createChoices = (sources: ChoicesSources, device: Choices): ChosenOnServer => {
    let latest: Choices | null = null
    let sending = false
    // This device marks a choice it has not sent yet; the choice itself is in its settings.
    const unsent = (): boolean => {
        try {
            return sources.storage.getItem(UNSENT) !== null
        } catch {
            return false
        }
    }
    const remember = (waiting: boolean): void => {
        try {
            if (waiting) sources.storage.setItem(UNSENT, '1')
            else sources.storage.removeItem(UNSENT)
        } catch {
            // Private browsing or a full store: sent this visit only.
        }
    }
    // Sends the latest choice until the server has it, waiting longer after each failure.
    const send = async (): Promise<void> => {
        if (sending) return
        sending = true
        let retry = FIRST_RETRY
        while (latest) {
            const choices = latest
            if (await sources.save(choices)) {
                if (latest === choices) {
                    latest = null
                    remember(false)
                }
                retry = FIRST_RETRY
                continue
            }
            await sources.wait(retry)
            retry = Math.min(LAST_RETRY, retry * 2)
        }
        sending = false
    }
    const choose = (choices: Choices): void => {
        latest = choices
        remember(true)
        void send()
    }
    const ready = unsent()
        ? Promise.resolve(null).then(() => {
            choose(device)
            return null
        })
        : sources.load()
    return { ready, choose }
}
