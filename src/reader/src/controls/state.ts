/** Whether the reader's controls show, and whether More is open over them. */
export interface ControlsState {
    shown: boolean
    more: boolean
}

/**
 * What happens to the controls: a tap in the middle of the page, a page
 * turned by the reader, the More button, or a tap outside More.
 */
export type ControlsEvent = 'middle' | 'turned' | 'more' | 'outside'

export const HIDDEN: ControlsState = { shown: false, more: false }

/**
 * The controls after `event`. A tap in the middle shows or hides them, a page
 * turn hides them, and the More button opens or closes More. While More is
 * open, a tap anywhere else only closes it.
 */
export const nextControls = (state: ControlsState, event: ControlsEvent): ControlsState => {
    switch (event) {
        case 'turned': return HIDDEN
        case 'more': return { shown: true, more: !state.more }
        case 'outside': return { ...state, more: false }
        case 'middle': return state.more ? { ...state, more: false } : { shown: !state.shown, more: false }
    }
}
