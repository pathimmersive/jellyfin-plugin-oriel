// Writes a minimal EPUB 3 book with known first-chapter text, for the smoke test.
// Usage: node e2e/make-epub.mjs <output.epub> <first-chapter text>
import { writeFileSync } from 'node:fs'
import { crc32 } from 'node:zlib'

const [output, chapterText] = process.argv.slice(2)
if (!output || !chapterText) {
    console.error('usage: node e2e/make-epub.mjs <output.epub> <first-chapter text>')
    process.exit(2)
}

const xhtml = (title, body) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">
<head><title>${title}</title></head>
<body>${body}</body>
</html>`

const files = [
    ['mimetype', 'application/epub+zip'],
    ['META-INF/container.xml', `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`],
    ['OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:5f0c7a52-3d1e-4f8b-9a43-0b6f2c1d9e01</dc:identifier>
    <dc:title>Oriel Smoke Book</dc:title>
    <dc:creator>Oriel</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`],
    ['OEBPS/nav.xhtml', xhtml('Contents', `<nav epub:type="toc"><ol>
<li><a href="ch1.xhtml">Chapter One</a></li>
<li><a href="ch2.xhtml">Chapter Two</a></li>
</ol></nav>`)],
    ['OEBPS/ch1.xhtml', xhtml('Chapter One', `<h1>Chapter One</h1><p>${chapterText}</p>`)],
    ['OEBPS/ch2.xhtml', xhtml('Chapter Two', '<h1>Chapter Two</h1><p>The second chapter.</p>')],
]

// Stored (uncompressed) zip entries, mimetype first, as EPUB requires.
const locals = []
const centrals = []
let offset = 0
for (const [name, text] of files) {
    const nameBytes = Buffer.from(name, 'utf8')
    const data = Buffer.from(text, 'utf8')
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    locals.push(local, nameBytes, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBytes)

    offset += local.length + nameBytes.length + data.length
}
const centralSize = centrals.reduce((n, b) => n + b.length, 0)
const end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50, 0)
end.writeUInt16LE(files.length, 8)
end.writeUInt16LE(files.length, 10)
end.writeUInt32LE(centralSize, 12)
end.writeUInt32LE(offset, 16)

writeFileSync(output, Buffer.concat([...locals, ...centrals, end]))
