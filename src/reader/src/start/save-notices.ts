import { ICONS, NOTICE_TEXT } from '../controls/failure'
import { showNotice } from './notices'
import { signIn } from './sign-in'

/** The notices that the place is not being saved. */
export interface SaveNotices {
    /** The session has ended: says so, with Sign in, until the page is left. */
    signedOut: () => void
    /** A place was saved, or was not: not saved shows until a save goes through. */
    saved(saved: boolean): void
}

export const createSaveNotices = (itemId: string): SaveNotices => {
    let shown: { kind: 'signedOut' | 'notSaved', element: HTMLElement } | null = null
    const show = (kind: 'signedOut' | 'notSaved' | null): void => {
        if (shown?.kind === 'signedOut' || shown?.kind === kind) return
        shown?.element.remove()
        shown = kind && {
            kind,
            element: kind === 'signedOut'
                ? showNotice(NOTICE_TEXT.signedOut, ICONS.person, { label: 'Sign in', run: () => void signIn(itemId) })
                : showNotice(NOTICE_TEXT.notSaved, ICONS.cloudOff),
        }
    }
    return {
        signedOut: () => show('signedOut'),
        saved: saved => show(saved ? null : 'notSaved'),
    }
}
