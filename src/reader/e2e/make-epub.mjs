// Writes a minimal EPUB 3 book with known first-chapter text, for the smoke test.
// It has four chapters of about 4,000 characters each, so a reading position
// given as a fraction of the book lands in a known chapter: 0.6 is in chapter
// three, whose first line is "Oriel smoke chapter three starts here."
// Usage: node e2e/make-epub.mjs <output.epub> <first-chapter text>
import { writeFileSync } from 'node:fs'
import { zip } from './zip.mjs'

const [output, chapterText] = process.argv.slice(2)
if (!output || !chapterText) {
    console.error('usage: node e2e/make-epub.mjs <output.epub> <first-chapter text>')
    process.exit(2)
}

const filler = Array.from({ length: 20 }, (_, i) =>
    `<p>Paragraph ${i + 1} holds plain filler text, so that every chapter is about the same length.</p>`).join('')
    + Array.from({ length: 20 }, () => '<p>More filler follows here, a line at a time, to pad the chapter out.</p>').join('')
// The nested entry marks a paragraph halfway through Chapter Two; the text is unchanged.
const NESTED_ID = 'second-half'
const NESTED_TITLE = 'Chapter Two, Second Half'
const nestedFiller = filler.replace('<p>Paragraph 11 ', `<p id="${NESTED_ID}">Paragraph 11 `)
const chapters = [
    ['ch1', 'Chapter One', chapterText],
    ['ch2', 'Chapter Two', 'Oriel smoke chapter two starts here.'],
    ['ch3', 'Chapter Three', 'Oriel smoke chapter three starts here.'],
    ['ch4', 'Chapter Four', 'Oriel smoke chapter four starts here.'],
]

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
${chapters.map(([id]) => `    <item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`).join('\n')}
  </manifest>
  <spine>
${chapters.map(([id]) => `    <itemref idref="${id}"/>`).join('\n')}
  </spine>
</package>`],
    // Chapter Two's contents entry has one nested entry, for its second half.
    ['OEBPS/nav.xhtml', xhtml('Contents', `<nav epub:type="toc"><ol>
${chapters.map(([id, title]) => `<li><a href="${id}.xhtml">${title}</a>${id === 'ch2' ? `<ol><li><a href="ch2.xhtml#${NESTED_ID}">${NESTED_TITLE}</a></li></ol>` : ''}</li>`).join('\n')}
</ol></nav>`)],
    ...chapters.map(([id, title, first]) => [`OEBPS/${id}.xhtml`, xhtml(title, `<h1>${title}</h1><p>${first}</p>${id === 'ch2' ? nestedFiller : filler}`)]),
]

// Stored zip entries, mimetype first, as EPUB requires.
writeFileSync(output, zip(files))
