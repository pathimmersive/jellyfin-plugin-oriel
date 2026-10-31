/** Whether the reader's controls show, and which of More or Contents is open over them. */
export interface ControlsState {
    shown: boolean
    more: boolean
    contents: boolean
}

/**
 * What happens to the controls: a tap in the middle of the page, a page
 * turned by the reader, the More or Contents button, a tap outside an open
 * panel (or its Close button, or Escape), or an entry chosen in Contents.
 */
export type ControlsEvent = 'middle' | 'turned' | 'more' | 'contents' | 'outside' | 'chosen'

export const HIDDEN: ControlsState = { shown: false, more: false, contents: false }

/**
 * The controls after `event`. A tap in the middle shows or hides them, and a
 * page turn or a chosen entry hides them. The More and Contents buttons open
 * or close their panel, one at a time. While a panel is open, a tap anywhere
 * else only closes it.
 */
export const nextControls = (state: ControlsState, event: ControlsEvent): ControlsState => {
    switch (event) {
        case 'turned':
        case 'chosen':
            return HIDDEN
        case 'more': return { shown: true, more: !state.more, contents: false }
        case 'contents': return { shown: true, more: false, contents: !state.contents }
        case 'outside': return { ...state, more: false, contents: false }
        case 'middle':
            return state.more || state.contents
                ? { ...state, more: false, contents: false }
                : { shown: !state.shown, more: false, contents: false }
    }
}
