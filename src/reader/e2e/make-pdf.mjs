// Writes a minimal PDF for the smoke test: two pages, each with one line of
// text in the standard Helvetica font, which the PDF does not embed, so the
// reader draws it with PDF.js's bundled standard fonts.
// Usage: node e2e/make-pdf.mjs <output.pdf> [first page's line]
import { writeFileSync } from 'node:fs'

const [output, first = 'Oriel smoke PDF page one opens here.'] = process.argv.slice(2)
if (!output) {
    console.error('usage: node e2e/make-pdf.mjs <output.pdf> [first page\'s line]')
    process.exit(2)
}

const lines = [first, 'Oriel smoke PDF page two follows.']
const escape = text => text.replace(/[\\()]/g, c => `\\${c}`)

// Objects in order: catalog, page tree, font, then a page and its content for each line.
const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${lines.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${lines.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
]
for (const [i, line] of lines.entries()) {
    const stream = `BT /F1 24 Tf 72 720 Td (${escape(line)}) Tj ET`
    objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    )
}

let pdf = '%PDF-1.4\n'
const offsets = objects.map((body, i) => {
    const offset = pdf.length
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
    return offset
})
const xref = pdf.length
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
pdf += offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
writeFileSync(output, pdf, 'latin1')
