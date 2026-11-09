// Writes PNGs of one colour for the smoke test's generated books.
import { crc32, deflateSync } from 'node:zlib'

const chunk = (type, data) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
}

/**
 * A truecolour PNG of one colour, [r, g, b], at the given size. A grain of
 * fixed pseudo-random noise keeps it from compressing, for a file of a
 * known, larger size.
 */
export const png = ([r, g, b], width = 600, height = 900, { grain = false } = {}) => {
    const header = Buffer.alloc(13)
    header.writeUInt32BE(width, 0)
    header.writeUInt32BE(height, 4)
    header[8] = 8 // bit depth
    header[9] = 2 // truecolour
    let seed = 1
    const noise = () => {
        seed ^= seed << 13
        seed ^= seed >>> 17
        seed ^= seed << 5
        return (seed >>> 0) % 33 - 16
    }
    const shade = value => grain ? Math.max(0, Math.min(255, value + noise())) : value
    const pixels = Buffer.concat(Array.from({ length: height }, () => {
        const row = Buffer.alloc(1 + width * 3)
        for (let x = 0; x < width; x++) row.set([shade(r), shade(g), shade(b)], 1 + x * 3)
        return row
    }))
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(pixels)),
        chunk('IEND', Buffer.alloc(0)),
    ])
}
