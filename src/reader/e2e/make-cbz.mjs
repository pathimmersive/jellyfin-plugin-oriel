// Writes a minimal comic book archive for the smoke test: four pages, each a
// 600x900 PNG of one colour, so the page shown can be told from its colour,
// and a ComicInfo.xml with the title.
// Usage: node e2e/make-cbz.mjs <output.cbz>
import { writeFileSync } from 'node:fs'
import { png } from './png.mjs'
import { zip } from './zip.mjs'

const [output] = process.argv.slice(2)
if (!output) {
    console.error('usage: node e2e/make-cbz.mjs <output.cbz>')
    process.exit(2)
}

// The page colours, in reading order; the smoke test checks them.
const PAGE_COLOURS = [[200, 30, 30], [30, 160, 30], [30, 60, 200], [220, 180, 20]]

writeFileSync(output, zip([
    ['ComicInfo.xml', '<?xml version="1.0" encoding="utf-8"?>\n<ComicInfo><Title>Oriel Smoke Comic</Title><Series>Oriel Smoke Comic</Series><Number>1</Number><PageCount>4</PageCount></ComicInfo>\n'],
    ...PAGE_COLOURS.map((colour, i) => [`page-${String(i + 1).padStart(2, '0')}.png`, png(colour)]),
]))
