import { BookLoadError } from '../api/client'

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
    // fetch rejects with a TypeError when no answer comes back at all.
    if (stage === 'downloaded' && error instanceof TypeError) return OFFLINE
    return { kind: 'other', title: `The book could not be ${stage}.`, body: describe(error), retry: false }
}

/** What a save's outcome says to the reader: signed out, not saved, or nothing once a save goes through. */
export const saveNotice = (saved: boolean, status: number | null): 'signedOut' | 'notSaved' | null =>
    saved ? null : status === 401 ? 'signedOut' : 'notSaved'

export const NOTICE_TEXT = {
    signedOut: 'You are signed out of Jellyfin, so your place is not being saved.',
    notSaved: 'Your place could not be saved. Oriel will try again when you turn the page.',
}

export const ICONS = {
    cloudOff: 'M19.35 10.04C18.67 6.59 15.64 4 12 4c-1.48 0-2.85.43-4.01 1.17l1.46 1.46C10.21 6.23 11.08 6 12 6c3.04 0 5.5 2.46 5.5 5.5v.5H19c1.66 0 3 1.34 3 3 0 1.13-.64 2.11-1.56 2.62l1.45 1.45C23.16 18.16 24 16.68 24 15c0-2.64-2.05-4.78-4.65-4.96zM3 5.27l2.75 2.74C2.56 8.15 0 10.77 0 14c0 3.31 2.69 6 6 6h11.73l2 2L21 20.73 4.27 4 3 5.27zM7.73 10l8 8H6c-2.21 0-4-1.79-4-4s1.79-4 4-4h1.73z',
    lock: 'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z',
    book: 'M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z',
    person: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
}

const svg = (path: string, size: number): string =>
    `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor"><path d="${path}"/></svg>`

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
    page.innerHTML = svg(failure.kind === 'offline' ? ICONS.cloudOff : failure.kind === 'drm' ? ICONS.lock : ICONS.book, 56)
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
