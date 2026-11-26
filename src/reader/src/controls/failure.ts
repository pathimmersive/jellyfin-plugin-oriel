import { BookLoadError, DownloadStalledError } from '../api/client'
import { icon, ICONS } from './icons'

/** Why a book did not open, as the failure page says it. */
export interface Failure {
    kind: 'offline' | 'drm' | 'notFound' | 'other'
    title: string
    body: string
    /** Whether Try again is offered: trying again can help. */
    retry: boolean
}

/** A DRM-protected book, found once it has downloaded. */
export class DrmError extends Error {
    constructor() {
        super('This book is protected with DRM')
        this.name = 'DrmError'
    }
}

const describe = (error: unknown): string =>
    error instanceof Error ? `${error.name}: ${error.message}` : String(error)

export const OFFLINE: Failure = {
    kind: 'offline',
    title: 'Oriel can’t reach your Jellyfin server.',
    body: 'Check your connection. The book opens as soon as the server answers.',
    retry: true,
}

/** Statuses a proxy in front of an unreachable server answers with. */
const UNREACHABLE = new Set([502, 503, 504])

/**
 * What the page says for an error at `stage` ('downloaded' while the book and
 * its saved places are fetched, 'opened' after), or 'signIn' for a session
 * that has expired, which goes to jellyfin-web's sign-in instead.
 */
export const failureFor = (error: unknown, stage: string): Failure | 'signIn' => {
    if (error instanceof DrmError) {
        return { kind: 'drm', title: 'This book can’t be opened.', body: 'It is protected with DRM, so only the app or store it came from can open it.', retry: false }
    }
    if (error instanceof BookLoadError) {
        if (error.status === 401) return 'signIn'
        if (error.status === 404) {
            return { kind: 'notFound', title: error.message, body: 'It may have been removed, or your account may not have access to it.', retry: false }
        }
        if (error.status !== undefined && UNREACHABLE.has(error.status)) return OFFLINE
        return { kind: 'other', title: error.message, body: `The server answered HTTP ${error.status ?? 'with an error'} while the book was ${stage}.`, retry: true }
    }
    if (error instanceof DownloadStalledError) return OFFLINE
    // fetch rejects with a TypeError when no answer comes back at all.
    if (stage === 'downloaded' && error instanceof TypeError) return OFFLINE
    return { kind: 'other', title: `The book could not be ${stage}.`, body: describe(error), retry: false }
}

export const NOTICE_TEXT = {
    signedOut: 'You are signed out of Jellyfin, so your place is not being saved.',
    notSaved: 'Your place could not be saved. Oriel will try again when you turn the page.',
    unavailable: 'Your reading data is unavailable on this server, so your place and notes will not be saved.',
    bookmarksFull: 'You have 5,000 bookmarks, the most Oriel keeps. Remove one to add another.',
    highlightsFull: 'You have 20,000 highlights, the most Oriel keeps. Remove one to add another.',
    highlightNotSaved: 'Your highlight could not be saved. Try again.',
    highlightNotRemoved: 'Your highlight could not be removed. Try again.',
    bookmarkNotSaved: 'Your bookmark could not be saved. Try again.',
    bookmarkNotRemoved: 'Your bookmark could not be removed. Try again.',
}

/**
 * The failure page, as the canvas's EdgeOffline, EdgeDrm and EdgeNotFound draw
 * it, in place of the book: an icon, `title` (the page's status line, so it is
 * read out), the body, Try again when the failure allows it, and Back to
 * Jellyfin. Showing it again replaces it.
 */
export const showFailure = (title: HTMLElement, failure: Failure, retry: () => void, home: string): void => {
    document.getElementById('failure')?.remove()
    const page = document.createElement('section')
    page.id = 'failure'
    page.dataset.kind = failure.kind
    page.innerHTML = icon(failure.kind === 'offline' ? ICONS.cloudOff : failure.kind === 'drm' ? ICONS.lock : ICONS.book, 56)
        + '<p class="body"></p><div class="buttons"></div>'
    title.textContent = failure.title
    page.insertBefore(title, page.querySelector('.body'))
    page.querySelector('.body')!.textContent = failure.body
    const buttons = page.querySelector('.buttons')!
    if (failure.retry) {
        const again = document.createElement('button')
        again.type = 'button'
        again.className = 'retry'
        again.textContent = 'Try again'
        again.addEventListener('click', retry)
        buttons.append(again)
    }
    const back = document.createElement('a')
    back.className = 'back'
    back.href = home
    back.textContent = 'Back to Jellyfin'
    buttons.append(back)
    document.body.append(page)
}

/** Takes the failure page away, putting the status line back where it was. */
export const clearFailure = (title: HTMLElement): void => {
    const page = document.getElementById('failure')
    if (!page) return
    document.body.prepend(title)
    title.textContent = ''
    page.remove()
}
