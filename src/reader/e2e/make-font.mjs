// Makes test font files from the bundled Fontsource fonts (SIL Open Font
// License): a WOFF file unpacked into a TrueType font, its family renamed so
// it cannot be taken for a bundled or installed font, written as TTF or
// packed again as WOFF2 (with glyf and loca untransformed).
// Usage: node e2e/make-font.mjs <source.woff> <family> <ttf|woff2> <output>
import { readFileSync, writeFileSync } from 'node:fs'
import { brotliCompressSync, inflateSync } from 'node:zlib'

/** The tables of a WOFF file, by tag, unpacked. */
const woffTables = woff => {
    if (woff.toString('latin1', 0, 4) !== 'wOFF') throw new Error('not a WOFF file')
    const tables = new Map()
    for (let i = 0; i < woff.readUInt16BE(12); i++) {
        const entry = 44 + i * 20
        const tag = woff.toString('latin1', entry, entry + 4)
        const offset = woff.readUInt32BE(entry + 4)
        const compressed = woff.readUInt32BE(entry + 8)
        const length = woff.readUInt32BE(entry + 12)
        const data = woff.subarray(offset, offset + compressed)
        tables.set(tag, compressed < length ? inflateSync(data) : Buffer.from(data))
    }
    return tables
}

/** The strings of a name table, by name id: Windows English first, else the first there is. */
const names = table => {
    const count = table.readUInt16BE(2)
    const strings = table.readUInt16BE(4)
    const found = new Map()
    for (let i = 0; i < count; i++) {
        const record = 6 + i * 12
        const [platform, , language, id, length, offset] = [0, 2, 4, 6, 8, 10].map(at => table.readUInt16BE(record + at))
        const raw = table.subarray(strings + offset, strings + offset + length)
        const text = platform === 1 ? raw.toString('latin1') : Buffer.from(raw.subarray(0, raw.length & ~1)).swap16().toString('utf16le')
        if (!found.has(id) || (platform === 3 && language === 0x409)) found.set(id, text)
    }
    return found
}

/** A name table of Windows English strings, by name id. */
const nameTable = strings => {
    const entries = [...strings].sort(([a], [b]) => a - b).map(([id, text]) => [id, Buffer.from(text, 'utf16le').swap16()])
    const header = Buffer.alloc(6 + entries.length * 12)
    header.writeUInt16BE(entries.length, 2)
    header.writeUInt16BE(header.length, 4)
    let offset = 0
    entries.forEach(([id, data], i) => {
        const record = 6 + i * 12
        header.writeUInt16BE(3, record)
        header.writeUInt16BE(1, record + 2)
        header.writeUInt16BE(0x409, record + 4)
        header.writeUInt16BE(id, record + 6)
        header.writeUInt16BE(data.length, record + 8)
        header.writeUInt16BE(offset, record + 10)
        offset += data.length
    })
    return Buffer.concat([header, ...entries.map(([, data]) => data)])
}

/** The tables with the family renamed: family, full and PostScript names, keeping the style. */
const renamed = (tables, family) => {
    const was = names(tables.get('name'))
    const style = was.get(17) ?? was.get(2) ?? 'Regular'
    const strings = new Map([
        [0, 'Test font for Oriel, made from a font under the SIL Open Font License.'],
        [1, family],
        [2, style],
        [3, `${family} ${style}`],
        [4, `${family} ${style}`],
        [5, was.get(5) ?? 'Version 1.0'],
        [6, `${family}-${style}`.replace(/[^A-Za-z0-9-]/g, '')],
    ])
    return new Map([...tables].map(([tag, data]) => [tag, tag === 'name' ? nameTable(strings) : data]))
}

const checksum = data => {
    const padded = Buffer.concat([data, Buffer.alloc((4 - data.length % 4) % 4)])
    let sum = 0
    for (let at = 0; at < padded.length; at += 4) sum = (sum + padded.readUInt32BE(at)) >>> 0
    return sum
}

/** A TrueType font of the tables, its checksums and head's adjustment worked out. */
export const sfnt = tables => {
    const tags = [...tables.keys()].sort()
    const head = Buffer.from(tables.get('head'))
    head.writeUInt32BE(0, 8)
    const data = new Map([...tables].map(([tag, table]) => [tag, tag === 'head' ? head : table]))
    const count = tags.length
    const power = 2 ** Math.floor(Math.log2(count))
    const directory = Buffer.alloc(12 + count * 16)
    directory.writeUInt32BE(0x00010000, 0)
    directory.writeUInt16BE(count, 4)
    directory.writeUInt16BE(power * 16, 6)
    directory.writeUInt16BE(Math.log2(power), 8)
    directory.writeUInt16BE(count * 16 - power * 16, 10)
    const bodies = []
    let offset = directory.length
    tags.forEach((tag, i) => {
        const table = data.get(tag)
        const record = 12 + i * 16
        directory.write(tag, record, 'latin1')
        directory.writeUInt32BE(checksum(table), record + 4)
        directory.writeUInt32BE(offset, record + 8)
        directory.writeUInt32BE(table.length, record + 12)
        const padded = Buffer.concat([table, Buffer.alloc((4 - table.length % 4) % 4)])
        bodies.push(padded)
        offset += padded.length
    })
    const font = Buffer.concat([directory, ...bodies])
    const headAt = directory.readUInt32BE(12 + tags.indexOf('head') * 16 + 8)
    font.writeUInt32BE((0xB1B0AFBA - checksum(font)) >>> 0, headAt + 8)
    return font
}

// WOFF2's known table tags, by the index its table directory gives them.
const KNOWN = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
    'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
    'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
    'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill']

const base128 = value => {
    const bytes = [value & 0x7f]
    for (value >>>= 7; value; value >>>= 7) bytes.unshift(0x80 | (value & 0x7f))
    return bytes
}

/** The font of the tables (from `sfnt`) packed as WOFF2, every table untransformed. */
export const woff2 = font => {
    const count = font.readUInt16BE(4)
    const entries = []
    for (let i = 0; i < count; i++) {
        const record = 12 + i * 16
        const tag = font.toString('latin1', record, record + 4)
        const offset = font.readUInt32BE(record + 8)
        entries.push({ tag, data: font.subarray(offset, offset + font.readUInt32BE(record + 12)) })
    }
    // loca follows glyf, as WOFF2 asks.
    entries.sort((a, b) => (a.tag === 'loca' ? 'glyf~' : a.tag).localeCompare(b.tag === 'loca' ? 'glyf~' : b.tag))
    const directory = entries.flatMap(({ tag, data }) => {
        const known = KNOWN.indexOf(tag)
        const version = tag === 'glyf' || tag === 'loca' ? 3 : 0
        return [(known < 0 ? 63 : known) | (version << 6), ...(known < 0 ? [...Buffer.from(tag, 'latin1')] : []), ...base128(data.length)]
    })
    const compressed = brotliCompressSync(Buffer.concat(entries.map(({ data }) => data)))
    const header = Buffer.alloc(48)
    const length = header.length + directory.length + compressed.length
    const padded = length + (4 - length % 4) % 4
    header.write('wOF2', 0, 'latin1')
    header.writeUInt32BE(0x00010000, 4)
    header.writeUInt32BE(padded, 8)
    header.writeUInt16BE(count, 12)
    header.writeUInt32BE(font.length, 16)
    header.writeUInt32BE(compressed.length, 20)
    header.writeUInt16BE(1, 24)
    return Buffer.concat([header, Buffer.from(directory), compressed, Buffer.alloc(padded - length)])
}

/** A test font: the WOFF file at `source` with its family renamed, as `format` (ttf or woff2). */
export const makeFont = (source, family, format) => {
    const font = sfnt(renamed(woffTables(readFileSync(source)), family))
    return format === 'woff2' ? woff2(font) : font
}

if (process.argv[1]?.endsWith('make-font.mjs')) {
    const [source, family, format, output] = process.argv.slice(2)
    if (!source || !family || !['ttf', 'woff2'].includes(format) || !output) {
        console.error('usage: node e2e/make-font.mjs <source.woff> <family> <ttf|woff2> <output>')
        process.exit(2)
    }
    writeFileSync(output, makeFont(source, family, format))
}
