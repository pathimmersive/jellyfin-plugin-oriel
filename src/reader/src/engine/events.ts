/**
 * The detail of an event foliate-js or the reader dispatches as a CustomEvent,
 * typed as the listener for that event's name expects it.
 */
export const detailOf = <T>(event: Event): T => (event as CustomEvent<T>).detail
