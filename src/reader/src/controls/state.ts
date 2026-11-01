/** Whether the reader's controls show, and which of More, Contents or Preferences is open over them. */
export interface ControlsState {
    shown: boolean
    more: boolean
    contents: boolean
    prefs: boolean
}

/**
 * What happens to the controls: a tap in the middle of the page, a page
 * turned by the reader, the More, Contents or Preferences button, a tap
 * outside an open panel (or its Close button, or Escape), or an entry chosen
 * in Contents.
 */
export type ControlsEvent = 'middle' | 'turned' | 'more' | 'contents' | 'prefs' | 'outside' | 'chosen'

export const HIDDEN: ControlsState = { shown: false, more: false, contents: false, prefs: false }

const CLOSED = { more: false, contents: false, prefs: false }

/**
 * The controls after `event`. A tap in the middle shows or hides them, and a
 * page turn or a chosen entry hides them. The More, Contents and Preferences
 * buttons open or close their panel, one at a time. While a panel is open, a
 * tap anywhere else only closes it.
 */
export const nextControls = (state: ControlsState, event: ControlsEvent): ControlsState => {
    switch (event) {
        case 'turned':
        case 'chosen':
            return HIDDEN
        case 'more': return { ...CLOSED, shown: true, more: !state.more }
        case 'contents': return { ...CLOSED, shown: true, contents: !state.contents }
        case 'prefs': return { ...CLOSED, shown: true, prefs: !state.prefs }
        case 'outside': return { ...state, ...CLOSED }
        case 'middle':
            return state.more || state.contents || state.prefs
                ? { ...state, ...CLOSED }
                : { ...CLOSED, shown: !state.shown }
    }
}
