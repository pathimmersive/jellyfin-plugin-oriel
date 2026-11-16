// Writes an EPUB 3 book whose sections try to run script in every way a book
// can: an inline script, a script file inside the book, a script from another
// origin, onload and onerror handlers, a javascript: link, a frame's inline
// document (srcdoc), a refresh redirect and a script inside an SVG section.
// Each one, if it ran, would record its name in the reader page's
// window.orielBookScripts or send a request to another origin, so the
// book-scripts check can tell that none of them ran. The frames section also
// frames jellyfin-web, loads an image and a background from another origin,
// and links to a web address and to an app's own scheme.
// Usage: node e2e/make-scripted-epub.mjs <output.epub>
import { writeFileSync } from 'node:fs'
import { zip } from './zip.mjs'

const [output] = process.argv.slice(2)
if (!output) {
    console.error('usage: node e2e/make-scripted-epub.mjs <output.epub>')
    process.exit(2)
}

// Records `name` on the reader page (the section frame's parent) if it runs.
const mark = name => `(window.top.orielBookScripts = window.top.orielBookScripts || []).push('${name}')`
const ELSEWHERE = 'https://oriel-book-script.invalid'

const xhtml = (title, body, head = '') => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">
<head><title>${title}</title>${head}</head>
<body onload="${mark('body-onload')}">${body}</body>
</html>`

const words = Array.from({ length: 12 }, (_, i) => `<p>Paragraph ${i + 1} of a book that tries to run scripts, which Oriel never lets it do.</p>`).join('')
const sections = [
    ['inline', 'Inline script', xhtml('Inline script',
        `<h1>Inline script</h1><p>Oriel book scripts chapter one.</p>${words}<script>${mark('inline')}</script>`)],
    ['file', 'Script file', xhtml('Script file',
        `<h1>Script file</h1><p>Oriel book scripts chapter two.</p>${words}`,
        '<script src="chapter.js"></script>')],
    ['elsewhere', 'Script from elsewhere', xhtml('Script from elsewhere',
        `<h1>Script from elsewhere</h1><p>Oriel book scripts chapter three.</p>${words}`,
        `<script src="${ELSEWHERE}/script.js"></script>`)],
    ['handlers', 'Handlers', xhtml('Handlers',
        `<h1>Handlers</h1><p>Oriel book scripts chapter four.</p>`
        + `<img src="missing.png" alt="" onerror="${mark('img-onerror')}"/>`
        + `<p><a id="run" href="javascript:${mark('javascript-link')}">A link that runs script</a></p>${words}`)],
    ['frames', 'Frames', xhtml('Frames',
        `<h1>Frames</h1><p>Oriel book scripts chapter five.</p>`
        + `<iframe id="inline-frame" srcdoc="&lt;script&gt;${mark('srcdoc')}&lt;/script&gt;"></iframe>`
        + '<iframe id="web-frame" src="/web/index.html"></iframe>'
        + `<img id="remote-image" src="${ELSEWHERE}/image.png" alt=""/>`
        + `<p style="background-image: url('${ELSEWHERE}/background.png')">A paragraph with a background from elsewhere.</p>`
        + `<p><a id="away" href="${ELSEWHERE}/away">A link to a web address</a></p>`
        + '<p><a id="app" href="ms-settings:privacy">A link to an app</a></p>'
        + words,
        `<meta http-equiv="Refresh" content="0; url=/web/index.html"/>`)],
]
const svg = `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800" onload="${mark('svg-onload')}">
<text x="40" y="80" font-size="32">Oriel book scripts chapter six.</text>
<script>${mark('svg-script')}</script>
</svg>`

const files = [
    ['mimetype', 'application/epub+zip'],
    ['META-INF/container.xml', `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`],
    ['OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:7a1d3c55-8e2f-4b6a-9c10-2f4e6d8b0a13</dc:identifier>
    <dc:title>Oriel Book Scripts</dc:title>
    <dc:creator>Oriel</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${sections.map(([id]) => `    <item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml" properties="scripted"/>`).join('\n')}
    <item id="svg" href="svg.svg" media-type="image/svg+xml" properties="scripted"/>
    <item id="js" href="chapter.js" media-type="application/javascript"/>
  </manifest>
  <spine>
${sections.map(([id]) => `    <itemref idref="${id}"/>`).join('\n')}
    <itemref idref="svg"/>
  </spine>
</package>`],
    ['OEBPS/nav.xhtml', xhtml('Contents', `<nav epub:type="toc"><ol>
${sections.map(([id, title]) => `<li><a href="${id}.xhtml">${title}</a></li>`).join('\n')}
<li><a href="svg.svg">SVG</a></li>
</ol></nav>`)],
    ...sections.map(([id, , body]) => [`OEBPS/${id}.xhtml`, body]),
    ['OEBPS/svg.svg', svg],
    ['OEBPS/chapter.js', `${mark('book-file')}; fetch('${ELSEWHERE}/from-book-file')`],
]

writeFileSync(output, zip(files))
