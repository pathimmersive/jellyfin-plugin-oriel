import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { BookLoadError, downloadErrorMessage } from '../src/api/client'
import { DrmError, failureFor, OFFLINE, saveNotice } from '../src/controls/failure'
import { drmProtected, encryptsMoreThanFonts, mobiEncrypted, zipEntry } from '../src/engine/drm'
import { zip } from '../e2e/zip.mjs'

const loadError = (status: number) => new BookLoadError(downloadErrorMessage(status), status)

describe('failureFor', () => {
    it('reads an answer that never came, and 502 to 504, as a server Oriel cannot reach', () => {
        expect(failureFor(new TypeError('Load failed'), 'downloaded')).toEqual(OFFLINE)
        for (const status of [502, 503, 504]) expect(failureFor(loadError(status), 'downloaded')).toEqual(OFFLINE)
        expect(OFFLINE.retry).toBe(true)
    })

    it('says a book was not found, with why, and offers no Try again', () => {
        expect(failureFor(loadError(404), 'downloaded')).toEqual({
            kind: 'notFound',
            title: 'This book was not found in your Jellyfin library.',
            body: 'It may have been removed, or your account may not have access to it.',
            retry: false,
        })
    })

    it('sends an expired session to sign in', () => {
        expect(failureFor(loadError(401), 'downloaded')).toBe('signIn')
    })

    it('says a book is protected with DRM, with no Try again', () => {
        expect(failureFor(new DrmError(), 'downloaded')).toMatchObject({ kind: 'drm', title: 'This book can’t be opened.', retry: false })
    })

    it('names any other failure, keeping the status or the browser\'s error for diagnosis', () => {
        expect(failureFor(loadError(403), 'downloaded')).toEqual({
            kind: 'other',
            title: 'You do not have permission to download this book. Ask your Jellyfin administrator.',
            body: 'The server answered HTTP 403 while the book was downloaded.',
            retry: true,
        })
        expect(failureFor(new Error('File type not supported'), 'opened')).toEqual({
            kind: 'other', title: 'The book could not be opened.', body: 'Error: File type not supported', retry: false,
        })
        // A TypeError once the book has downloaded is the book's, not the network's.
        expect(failureFor(new TypeError('x is undefined'), 'opened')).toMatchObject({ kind: 'other' })
    })
})

describe('saveNotice', () => {
    it('says signed out for a save refused with 401, not saved for another failure, and nothing once one goes through', () => {
        expect(saveNotice(false, 401)).toBe('signedOut')
        expect(saveNotice(false, null)).toBe('notSaved')
        expect(saveNotice(false, 500)).toBe('notSaved')
        expect(saveNotice(true, null)).toBeNull()
    })
})

const ENCRYPTION = (algorithm: string) => `<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
<enc:EncryptedData><enc:EncryptionMethod Algorithm="${algorithm}"/><enc:CipherData><enc:CipherReference URI="OEBPS/ch1.xhtml"/></enc:CipherData></enc:EncryptedData></encryption>`
const AES = 'http://www.w3.org/2001/04/xmlenc#aes128-cbc'
const IDPF = 'http://www.idpf.org/2008/embedding'

describe('encryptsMoreThanFonts', () => {
    it('finds content encrypted by a store, and lets obfuscated fonts through', () => {
        expect(encryptsMoreThanFonts(ENCRYPTION(AES))).toBe(true)
        expect(encryptsMoreThanFonts(ENCRYPTION(IDPF))).toBe(false)
        expect(encryptsMoreThanFonts(ENCRYPTION('http://ns.adobe.com/pdf/enc#RC'))).toBe(false)
        expect(encryptsMoreThanFonts(ENCRYPTION(IDPF) + ENCRYPTION(AES))).toBe(true)
        expect(encryptsMoreThanFonts('<encryption/>')).toBe(false)
    })
})

const epub = (encryption?: string): Uint8Array => new Uint8Array(zip([
    ['mimetype', 'application/epub+zip'],
    ...(encryption ? [['META-INF/encryption.xml', encryption]] : []),
    ['OEBPS/ch1.xhtml', '<html/>'],
]))

// The same archive with an entry deflated, as most EPUBs are made.
const deflated = (name: string, content: string): Uint8Array => {
    const data = deflateRawSync(Buffer.from(content))
    const nameBytes = Buffer.from(name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt16LE(nameBytes.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt16LE(nameBytes.length, 28)
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(1, 8)
    end.writeUInt16LE(1, 10)
    end.writeUInt32LE(46 + nameBytes.length, 12)
    end.writeUInt32LE(30 + nameBytes.length + data.length, 16)
    return new Uint8Array(Buffer.concat([local, nameBytes, data, central, nameBytes, end]))
}

// A PalmDB named BOOKMOBI whose first record's PalmDOC header has `encryption`.
const mobi = (encryption: number): Uint8Array => {
    const bytes = new Uint8Array(200)
    bytes.set(new TextEncoder().encode('BOOKMOBI'), 60)
    bytes[81] = 96
    bytes[96 + 13] = encryption
    return bytes
}

describe('zipEntry', () => {
    it('reads a stored or a deflated file, and nothing for one the archive lacks', async () => {
        expect(new TextDecoder().decode((await zipEntry(epub(ENCRYPTION(AES)), 'META-INF/encryption.xml'))!)).toBe(ENCRYPTION(AES))
        expect(new TextDecoder().decode((await zipEntry(deflated('META-INF/encryption.xml', ENCRYPTION(AES)), 'META-INF/encryption.xml'))!)).toBe(ENCRYPTION(AES))
        expect(await zipEntry(epub(), 'META-INF/encryption.xml')).toBeNull()
        expect(await zipEntry(new Uint8Array(10), 'META-INF/encryption.xml')).toBeNull()
    })
})

describe('mobiEncrypted', () => {
    it('reads the encryption type in the PalmDOC header', () => {
        expect(mobiEncrypted(mobi(2))).toBe(true)
        expect(mobiEncrypted(mobi(1))).toBe(true)
        expect(mobiEncrypted(mobi(0))).toBe(false)
        expect(mobiEncrypted(new Uint8Array(200))).toBe(false)
    })
})

// A Blob of the bytes, copied so their buffer is a plain ArrayBuffer.
const blob = (bytes: Uint8Array | string): Blob => new Blob([typeof bytes === 'string' ? bytes : bytes.slice()])

describe('drmProtected', () => {
    it('finds DRM in an EPUB or a MOBI, not in one with obfuscated fonts or none', async () => {
        expect(await drmProtected(blob(epub(ENCRYPTION(AES))))).toBe(true)
        expect(await drmProtected(blob(deflated('META-INF/encryption.xml', ENCRYPTION(AES))))).toBe(true)
        expect(await drmProtected(blob(epub(ENCRYPTION(IDPF))))).toBe(false)
        expect(await drmProtected(blob(epub()))).toBe(false)
        expect(await drmProtected(blob(mobi(2)))).toBe(true)
        expect(await drmProtected(blob(mobi(0)))).toBe(false)
        expect(await drmProtected(blob('%PDF-1.7'))).toBe(false)
    })
})
