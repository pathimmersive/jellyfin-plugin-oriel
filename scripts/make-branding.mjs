// Makes Oriel's logo images from the SVG sources in branding/: the plugin's
// catalog image, the GitHub social preview, and the reader's icons and
// loading-screen logo. Each PNG is drawn by Chromium from its source, so every
// image can be made again from the source.
// Usage: node scripts/make-branding.mjs          writes the images
//        node scripts/make-branding.mjs --check  fails when an image no longer matches its source,
//                                                or an image the README names is missing
// Playwright comes from the reader's packages (npm ci in src/reader).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const root = new URL('../', import.meta.url)
const { chromium } = createRequire(new URL('src/reader/package.json', root))('playwright')
const at = path => new URL(path, root)

// Each image: its source, where it goes, and its size in pixels (none for an SVG copied as it is).
const IMAGES = [
    { from: 'branding/oriel-catalog.svg', to: 'src/Jellyfin.Plugin.Oriel/oriel.png', size: [1920, 1080] },
    { from: 'branding/oriel-social.svg', to: 'branding/oriel-social.png', size: [1280, 640] },
    { from: 'branding/oriel-icon.svg', to: 'src/reader/public/favicon.svg' },
    { from: 'branding/oriel-icon.svg', to: 'src/reader/public/favicon-32.png', size: [32, 32] },
    { from: 'branding/oriel-icon.svg', to: 'src/reader/public/apple-touch-icon.png', size: [180, 180] },
    { from: 'branding/oriel-icon.svg', to: 'src/reader/public/icon-192.png', size: [192, 192] },
    { from: 'branding/oriel-icon.svg', to: 'src/reader/public/icon-512.png', size: [512, 512] },
    { from: 'branding/oriel-icon-maskable.svg', to: 'src/reader/public/icon-maskable-512.png', size: [512, 512] },
    { from: 'branding/oriel-lockup-dark.svg', to: 'src/reader/public/oriel-logo.svg' },
]

// The most a re-drawn image may differ from the one kept, on average per colour channel out of 255:
// enough for one system's anti-aliasing against another's, far too little for a changed drawing.
const TOLERANCE = 2

const check = process.argv.includes('--check')
const browser = await chromium.launch()
let failed = false
try {
    const page = await browser.newPage()
    for (const { from, to, size } of IMAGES) {
        const source = readFileSync(at(from))
        if (!size) {
            if (check) {
                let kept = null
                try { kept = readFileSync(at(to)) } catch { /* missing */ }
                if (!kept?.equals(source)) {
                    console.error(`FAIL: ${to} is not a copy of ${from}`)
                    failed = true
                }
            } else {
                writeFileSync(at(to), source)
            }
            continue
        }
        const [width, height] = size
        await page.setViewportSize({ width, height })
        await page.setContent(`<html><body style="margin:0"><img style="display:block;width:${width}px;height:${height}px" src="data:image/svg+xml;base64,${source.toString('base64')}"></body></html>`)
        await page.waitForFunction(() => document.images[0].complete)
        const drawn = await page.screenshot({ clip: { x: 0, y: 0, width, height } })
        if (!check) {
            writeFileSync(at(to), drawn)
            continue
        }
        let kept = null
        try { kept = readFileSync(at(to)) } catch { /* missing */ }
        if (!kept) {
            console.error(`FAIL: ${to} is missing; make it with node scripts/make-branding.mjs`)
            failed = true
            continue
        }
        const difference = await page.evaluate(async ([a, b]) => {
            const pixels = async base64 => {
                const image = new Image()
                image.src = `data:image/png;base64,${base64}`
                await image.decode()
                const canvas = document.createElement('canvas')
                canvas.width = image.naturalWidth
                canvas.height = image.naturalHeight
                const context = canvas.getContext('2d')
                context.drawImage(image, 0, 0)
                return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data }
            }
            const [x, y] = await Promise.all([pixels(a), pixels(b)])
            if (x.width !== y.width || x.height !== y.height) return { size: `${y.width}x${y.height}` }
            let sum = 0
            for (let i = 0; i < x.data.length; i++) sum += Math.abs(x.data[i] - y.data[i])
            return { mean: sum / x.data.length }
        }, [drawn.toString('base64'), kept.toString('base64')])
        if (difference.size) {
            console.error(`FAIL: ${to} is ${difference.size}, expected ${width}x${height}`)
            failed = true
        } else if (difference.mean > TOLERANCE) {
            console.error(`FAIL: ${to} differs from ${from} by ${difference.mean.toFixed(2)} per channel`)
            failed = true
        } else {
            console.log(`PASS: ${to} matches ${from} (${difference.mean.toFixed(2)} per channel)`)
        }
    }
} finally {
    await browser.close()
}
// Every image the README names, in src, srcset or Markdown, is in the repository.
if (check) {
    const readme = readFileSync(at('README.md'), 'utf8')
    const named = [...readme.matchAll(/(?:src|srcset)="([^"]+)"|!\[[^\]]*\]\(([^)\s]+)/g)].map(match => match[1] ?? match[2])
    for (const path of named.filter(path => !/^[a-z]+:/i.test(path))) {
        if (existsSync(at(path))) {
            console.log(`PASS: README.md names ${path}, which exists`)
        } else {
            console.error(`FAIL: README.md names ${path}, which is missing`)
            failed = true
        }
    }
}
if (!check) console.log(`make-branding: wrote ${IMAGES.length} images`)
process.exit(failed ? 1 : 0)
