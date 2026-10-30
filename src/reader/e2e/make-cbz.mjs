// Writes a minimal comic book archive for the smoke test: four pages, each a
// 600x900 PNG of one colour, so the page shown can be told from its colour,
// and a ComicInfo.xml with the title.
// Usage: node e2e/make-cbz.mjs <output.cbz>
import { writeFileSync } from 'node:fs'
import { crc32, deflateSync } from 'node:zlib'
import { zip } from './zip.mjs'

const [output] = process.argv.slice(2)
if (!output) {
    console.error('usage: node e2e/make-cbz.mjs <output.cbz>')
    process.exit(2)
}

// The page colours, in reading order; the smoke test checks them.
const PAGE_COLOURS = [[200, 30, 30], [30, 160, 30], [30, 60, 200], [220, 180, 20]]

const chunk = (type, data) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
}

const png = ([r, g, b], width = 600, height = 900) => {
    const header = Buffer.alloc(13)
    header.writeUInt32BE(width, 0)
    header.writeUInt32BE(height, 4)
    header[8] = 8 // bit depth
    header[9] = 2 // truecolour
    const row = Buffer.alloc(1 + width * 3)
    for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3)
    const pixels = Buffer.concat(Array.from({ length: height }, () => row))
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(pixels)),
        chunk('IEND', Buffer.alloc(0)),
    ])
}

writeFileSync(output, zip([
    ['ComicInfo.xml', '<?xml version="1.0" encoding="utf-8"?>\n<ComicInfo><Title>Oriel Smoke Comic</Title><Series>Oriel Smoke Comic</Series><Number>1</Number><PageCount>4</PageCount></ComicInfo>\n'],
    ...PAGE_COLOURS.map((colour, i) => [`page-${String(i + 1).padStart(2, '0')}.png`, png(colour)]),
]))
