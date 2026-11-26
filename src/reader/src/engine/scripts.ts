import { detailOf } from './events'

// No script inside a book runs. The reader's Content-Security-Policy already
// refuses them; this removes them as each section is prepared, so a section
// never carries one into its frame at all.

const MARKUP = ['application/xhtml+xml', 'text/html', 'image/svg+xml']

// Attributes that may hold a URL a click or load would follow.
const URL_ATTRIBUTES = ['href', 'src', 'xlink:href', 'action', 'formaction', 'data']

/** Whether a URL would run script when followed. */
export const isScriptUrl = (url: string): boolean =>
    // Browsers ignore whitespace and control characters inside a scheme.
    url.replace(/[\u0000- ]/g, '').toLowerCase().startsWith('javascript:')

/** Whether a link in a book may open outside the reader: only web and mail addresses, never an app's own scheme. */
export const isOpenableLink = (url: string): boolean => /^(https?:\/\/|mailto:)/i.test(url.trim())

/**
 * Removes script elements, event handler attributes, javascript: URLs, frames'
 * inline documents (srcdoc) and refresh redirects from a parsed section.
 */
export const stripScripts = (doc: Document): void => {
    for (const script of doc.querySelectorAll('script')) script.remove()
    for (const refresh of doc.querySelectorAll('meta[http-equiv]')) {
        if (refresh.getAttribute('http-equiv')?.trim().toLowerCase() === 'refresh') refresh.remove()
    }
    for (const element of doc.querySelectorAll('*')) {
        for (const attribute of [...element.attributes]) {
            const name = attribute.name.toLowerCase()
            if (name.startsWith('on') || name === 'srcdoc' || (URL_ATTRIBUTES.includes(name) && isScriptUrl(attribute.value))) {
                element.removeAttribute(attribute.name)
            }
        }
    }
}

/** A section's markup as it is shown: parsed, stripped and written back, or left as it was when it is not markup. */
export const withoutScripts = (data: string, type: string): string => {
    const mediaType = MARKUP.find(markup => type.startsWith(markup))
    if (!mediaType) return data
    const doc = new DOMParser().parseFromString(data, mediaType as DOMParserSupportedType)
    stripScripts(doc)
    return mediaType === 'text/html' ? `<!DOCTYPE html>${doc.documentElement.outerHTML}` : new XMLSerializer().serializeToString(doc)
}

/**
 * Strips every section foliate-js prepares for this book before the section's
 * blob: URL is made: through its transformTarget's `data` event (EPUB, KF8),
 * or, for an old-format MOBI, which has none, as the book parses each section
 * (its loadSection builds the section from createDocument).
 */
export const stripSections = (book: object): void => {
    const { transformTarget: target, createDocument } = book as { transformTarget?: EventTarget, createDocument?: (section: unknown) => Promise<Document> }
    if (!target && typeof createDocument === 'function') {
        Object.assign(book, {
            createDocument: async (section: unknown) => {
                const doc = await createDocument.call(book, section)
                stripScripts(doc)
                return doc
            },
        })
    }
    target?.addEventListener('data', event => {
        const detail = detailOf<{ data: unknown, type: unknown }>(event)
        const { data, type } = detail
        detail.data = Promise.all([data, type]).then(([text, mediaType]) =>
            typeof text === 'string' && typeof mediaType === 'string' ? withoutScripts(text, mediaType) : text)
    })
}
