/// <reference types="vitest/config" />
import { cpSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

// foliate-js loads its PDF adapter on demand, so PDF.js lands in a chunk of its
// own that only a PDF fetches. The adapter finds PDF.js's worker, styles, fonts
// and character maps at vendor/pdfjs/ beside its chunk, so they are copied
// there as they are; pdf.mjs itself is bundled into the chunk. Vite reads the
// adapter's `new URL(`vendor/pdfjs/${path}`, import.meta.url)` as a file glob,
// so that one expression is rewritten to the same URL in a form Vite leaves alone.
const pdfjsFiles = (): Plugin => {
    let outDir = ''
    return {
        name: 'oriel-pdfjs-files',
        enforce: 'pre',
        transform(code, id) {
            if (!id.replace(/\\/g, '/').endsWith('/vendor/foliate-js/pdf.js')) return null
            const from = 'new URL(`vendor/pdfjs/${path}`, import.meta.url)'
            if (!code.includes(from)) this.error('the PDF adapter no longer builds PDF.js paths as expected')
            return code.replace(from, "new URL(`vendor/pdfjs/${path}`, import.meta['url'])")
        },
        configResolved(config) {
            outDir = resolve(config.root, config.build.outDir, config.build.assetsDir)
        },
        writeBundle() {
            const from = fileURLToPath(new URL('./vendor/foliate-js/vendor/pdfjs', import.meta.url))
            cpSync(from, resolve(outDir, 'vendor/pdfjs'), {
                recursive: true,
                filter: source => basename(source) !== 'pdf.mjs',
            })
        },
    }
}

export default defineConfig({
    // Relative asset URLs keep the reader working under a Jellyfin BaseUrl.
    base: './',
    define: {
        __ORIEL_VERSION__: JSON.stringify(version),
    },
    plugins: [pdfjsFiles()],
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        target: 'es2022',
        // The reader, and the Your reading data page beside it.
        rollupOptions: {
            input: {
                index: fileURLToPath(new URL('./index.html', import.meta.url)),
                data: fileURLToPath(new URL('./data.html', import.meta.url)),
            },
        },
    },
    test: {
        include: ['tests/**/*.test.ts'],
        environment: 'node',
    },
})
