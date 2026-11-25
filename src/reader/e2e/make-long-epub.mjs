// Writes a long EPUB 3 book for the smoke test: 40 chapters of about 24,000
// characters each, plain paragraphs under a heading. No element has an id, so
// where a place is in it (its CFI) can be worked out from the numbers below.
// Usage: node e2e/make-long-epub.mjs <output.epub>
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { zip } from './zip.mjs'

export const CHAPTERS = 40
export const PARAGRAPHS = 120

const SENTENCE = 'The road ran on past the mill and the low wall, and the light went slowly over the fields while the carts came home. '
// Each is about 200 characters, so a chapter is about 24,000.
export const paragraph = (chapter, number) => `Chapter ${chapter}, paragraph ${number}. ${SENTENCE}${SENTENCE}`.slice(0, 200).trim()

const xhtml = (title, body) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">
<head><title>${title}</title></head>
<body>${body}</body>
</html>`

const numbers = count => Array.from({ length: count }, (_, i) => i + 1)

const files = () => [
    ['mimetype', 'application/epub+zip'],
    ['META-INF/container.xml', `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`],
    ['OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:0b1f6a3e-6f0c-4f3e-8f0e-6a4f3f1d7c40</dc:identifier>
    <dc:title>Oriel Long Book</dc:title>
    <dc:creator>Oriel</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${numbers(CHAPTERS).map(n => `    <item id="ch${n}" href="ch${n}.xhtml" media-type="application/xhtml+xml"/>`).join('\n')}
  </manifest>
  <spine>
${numbers(CHAPTERS).map(n => `    <itemref idref="ch${n}"/>`).join('\n')}
  </spine>
</package>`],
    ['OEBPS/nav.xhtml', xhtml('Contents', `<nav epub:type="toc"><ol>
${numbers(CHAPTERS).map(n => `<li><a href="ch${n}.xhtml">Chapter ${n}</a></li>`).join('\n')}
</ol></nav>`)],
    ...numbers(CHAPTERS).map(n => [`OEBPS/ch${n}.xhtml`, xhtml(`Chapter ${n}`,
        `<h1>Chapter ${n}</h1>${numbers(PARAGRAPHS).map(p => `<p>${paragraph(n, p)}</p>`).join('')}`)]),
]

/** The CFI of a character of a paragraph (both from 1); to a later character of it when `to` is given. */
export const cfiOf = (chapter, number, at, to = null) => {
    // Elements count in twos: the body is the second of its document, and the heading its first child.
    const element = `/6/${chapter * 2}!/4/${(number + 1) * 2}`
    return to === null ? `epubcfi(${element}/1:${at})` : `epubcfi(${element},/1:${at},/1:${to})`
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [output] = process.argv.slice(2)
    if (!output) {
        console.error('usage: node e2e/make-long-epub.mjs <output.epub>')
        process.exit(2)
    }
    writeFileSync(output, zip(files()))
}
