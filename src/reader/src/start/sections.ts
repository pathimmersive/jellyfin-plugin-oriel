import type { LastInput } from '../controls/hint'
import { detailOf } from '../engine/events'

/** What listens in every section's window. */
export interface SectionWatcher {
    watch(win: Window): void
}

/** The windows of the book's sections, as they load. */
export interface Sections {
    /** Watches the sections `view` loads. */
    watch(view: EventTarget): void
    /** Has `watchers` watch every section from now on, and those loaded before. */
    add(watchers: SectionWatcher[]): void
}

/**
 * The reader's last input is followed in every section's window, and what
 * listens there for Escape too, once it exists.
 */
export const createSections = (input: LastInput): Sections => {
    // The windows that load before there are watchers; null after that, so no window outlives its section.
    let windows: Window[] | null = []
    let watching: SectionWatcher[] = []
    return {
        watch: view => view.addEventListener('load', event => {
            const win = detailOf<{ doc: Document }>(event).doc.defaultView
            if (!win) return
            input.watch(win)
            windows?.push(win)
            for (const watcher of watching) watcher.watch(win)
        }),
        add(watchers) {
            watching = watchers
            for (const win of windows ?? []) {
                for (const watcher of watchers) watcher.watch(win)
            }
            windows = null
        },
    }
}
