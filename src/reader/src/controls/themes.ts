import type { OwnTheme } from '../settings/settings'

/** A theme in a whole list sent to be kept: a new one has no id. */
export type ThemeEdit = Omit<OwnTheme, 'id'> & { id?: string }

/** The reader's own themes, kept on the server. */
export interface OwnThemes {
    /** The themes in their order. */
    list(): OwnTheme[]
    /** Keeps a whole list; the themes as kept, or null when the server did not take it. */
    save(list: ThemeEdit[]): Promise<OwnTheme[] | null>
    /** Calls `changed` whenever the list changes. */
    onChange(changed: () => void): void
}

/** What the themes need: the server. */
export interface ThemeSources {
    load(): Promise<OwnTheme[] | null>
    save(list: ThemeEdit[]): Promise<OwnTheme[] | null>
}

/** The reader's own themes: none until the server's list loads. `ready` settles once it has. */
export const createOwnThemes = (sources: ThemeSources): OwnThemes & { ready: Promise<boolean> } => {
    let kept: OwnTheme[] = []
    const listeners: (() => void)[] = []
    const take = (themes: OwnTheme[]): OwnTheme[] => {
        kept = themes
        for (const listener of listeners) listener()
        return kept
    }
    const ready = sources.load().then(loaded => {
        if (loaded) take(loaded)
        return !!loaded
    })
    return {
        ready,
        list: () => [...kept],
        async save(list) {
            const saved = await sources.save(list)
            return saved ? take(saved) : null
        },
        onChange(listener) {
            listeners.push(listener)
        },
    }
}
