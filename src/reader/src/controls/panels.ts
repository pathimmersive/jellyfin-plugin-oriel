import type { Bar } from './bar'
import type { ContentsPanel } from './contents-panel'
import type { More } from './more'
import type { Preferences } from './preferences'
import type { SearchPanel } from './search-panel'
import { type ControlsEvent, type ControlsState, HIDDEN, nextControls } from './state'

/** What shows and hides as the controls do. */
export interface PanelParts {
    bar: Bar
    more: More
    contents: ContentsPanel
    preferences: Preferences
    search: SearchPanel
    /** A panel beside the page (Contents, Preferences, Search) opened or closed. */
    panel: (open: boolean) => void
}

/** Which of the controls show. */
export interface Panels {
    state(): ControlsState
    /** Shows and hides what `event` does. */
    apply(event: ControlsEvent): void
    /** The page's arrows again, as the place or its edges change. */
    showArrows(): void
}

/** The controls showing and hiding, with the one panel open over them at a time. */
export const createPanels = ({ bar, more, contents, preferences, search, panel }: PanelParts): Panels => {
    let state: ControlsState = HIDDEN
    let panelOpen = false
    const showArrows = (): void => bar.showArrows(panelOpen)
    const show = (): void => {
        const open = state.contents || state.prefs || state.search
        if (open !== panelOpen) {
            panelOpen = open
            panel(open)
        }
        showArrows()
        bar.bar.hidden = !state.shown
        bar.reading.hidden = state.shown
        more.menu.hidden = !state.more
        more.backdrop.hidden = !state.more
        bar.moreButton.setAttribute('aria-expanded', String(state.more))
        contents.panel.hidden = !state.contents
        contents.backdrop.hidden = !state.contents
        bar.contentsButton.setAttribute('aria-expanded', String(state.contents))
        preferences.panel.hidden = !state.prefs
        preferences.backdrop.hidden = !state.prefs
        bar.prefsButton.setAttribute('aria-expanded', String(state.prefs))
        search.panel.hidden = !state.search
        search.backdrop.hidden = !state.search
    }
    const apply = (event: ControlsEvent): void => {
        const opening = event === 'contents' && !state.contents
        const openingPrefs = event === 'prefs' && !state.prefs
        const openingSearch = event === 'search' && !state.search
        state = nextControls(state, event)
        show()
        // Fill on opening, so the entry being read is the one marked, and show it.
        if (opening) contents.opened()
        if (openingPrefs) preferences.opened()
        if (openingSearch) search.focus()
    }
    show()

    bar.moreButton.addEventListener('click', () => apply('more'))
    more.backdrop.addEventListener('click', () => apply('outside'))
    bar.contentsButton.addEventListener('click', () => apply('contents'))
    contents.backdrop.addEventListener('click', () => apply('outside'))
    contents.close.addEventListener('click', () => apply('outside'))
    bar.prefsButton.addEventListener('click', () => apply('prefs'))
    preferences.backdrop.addEventListener('click', () => apply('outside'))
    preferences.close.addEventListener('click', () => apply('outside'))
    more.search.addEventListener('click', () => apply('search'))
    search.backdrop.addEventListener('click', () => apply('outside'))
    search.close.addEventListener('click', () => apply('outside'))
    return { state: () => state, apply, showArrows }
}
