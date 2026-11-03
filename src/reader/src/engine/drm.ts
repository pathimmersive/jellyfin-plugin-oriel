// The algorithms EPUB readers use to obfuscate embedded fonts, which any reader
// can undo: the IDPF's and Adobe's. Anything else in encryption.xml is DRM.
const FONT_OBFUSCATION = new Set([
    'http://www.idpf.org/2008/embedding',
    'http://ns.adobe.com/pdf/enc#RC',
])

/** True when an EPUB's META-INF/encryption.xml encrypts anything but obfuscated fonts. */
export const encryptsMoreThanFonts = (xml: string): boolean => {
    const algorithms = [...xml.matchAll(/<(?:[\w-]+:)?EncryptionMethod\b[^>]*\bAlgorithm\s*=\s*["']([^"']+)["']/g)].map(match => match[1])
    return algorithms.some(algorithm => !FONT_OBFUSCATION.has(algorithm))
}

const u16 = (bytes: Uint8Array, at: number): number => bytes[at] | (bytes[at + 1] << 8)
const u32 = (bytes: Uint8Array, at: number): number => (u16(bytes, at) | (u16(bytes, at + 2) << 16)) >>> 0

/**
 * A file's bytes from a zip archive, read from its central directory, or null
 * when the archive has no such file or it cannot be read.
 */
export const zipEntry = async (bytes: Uint8Array, name: string): Promise<Uint8Array | null> => {
    // The end of central directory record is in the last 64 KiB and 22 bytes.
    let end = -1
    for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
        if (u32(bytes, at) === 0x06054b50) {
            end = at
            break
        }
    }
    if (end < 0) return null
    const entries = u16(bytes, end + 10)
    let at = u32(bytes, end + 16)
    const wanted = new TextEncoder().encode(name)
    for (let i = 0; i < entries && at + 46 <= bytes.length && u32(bytes, at) === 0x02014b50; i++) {
        const method = u16(bytes, at + 10)
        const size = u32(bytes, at + 20)
        const nameLength = u16(bytes, at + 28)
        const next = at + 46 + nameLength + u16(bytes, at + 30) + u16(bytes, at + 32)
        const entryName = bytes.subarray(at + 46, at + 46 + nameLength)
        if (entryName.length === wanted.length && entryName.every((b, k) => b === wanted[k])) {
            const local = u32(bytes, at + 42)
            if (u32(bytes, local) !== 0x04034b50) return null
            const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28)
            const data = bytes.subarray(start, start + size)
            if (method === 0) return data
            if (method !== 8) return null
            try {
                const inflated = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
                return new Uint8Array(await new Response(inflated).arrayBuffer())
            } catch {
                return null
            }
        }
        at = next
    }
    return null
}

/**
 * True when a MOBI or AZW3 file says it is encrypted: a PalmDB whose type is
 * BOOKMOBI, with an encryption type other than 0 in the PalmDOC header that
 * starts its first record.
 */
export const mobiEncrypted = (bytes: Uint8Array): boolean => {
    if (bytes.length < 82 || new TextDecoder().decode(bytes.subarray(60, 68)) !== 'BOOKMOBI') return false
    const record = ((bytes[78] << 24) | (bytes[79] << 16) | (bytes[80] << 8) | bytes[81]) >>> 0
    if (record + 14 > bytes.length) return false
    return ((bytes[record + 12] << 8) | bytes[record + 13]) !== 0
}

/** True when a book file is protected with DRM, so the reader cannot open it. */
export const drmProtected = async (file: Blob): Promise<boolean> => {
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (mobiEncrypted(bytes)) return true
    if (u32(bytes, 0) !== 0x04034b50) return false
    const encryption = await zipEntry(bytes, 'META-INF/encryption.xml')
    return encryption !== null && encryptsMoreThanFonts(new TextDecoder().decode(encryption))
}
