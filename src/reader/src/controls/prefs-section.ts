import type { Settings } from '../settings/settings'

/** What every section of Preferences works on. */
export interface PrefsContext {
    /** The settings as they are. */
    settings(): Settings
    /** Applies a change at once. */
    choose(changed: Partial<Settings>): void
    /** True on a screen wider than a phone's. */
    wide(): boolean
    /** True for comics and PDFs, whose pages have no text to restyle. */
    fixedLayout: boolean
}

/** A section of Preferences. */
export interface PrefsSection {
    /** The section, or the sections' shared row. */
    box: HTMLElement
    /** Shows the settings as they are. */
    fill(): void
}
