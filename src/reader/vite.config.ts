/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

// foliate-js loads its PDF adapter on demand, and that adapter pulls in PDF.js.
// PDF is not supported yet and PDF.js is not vendored, so the import resolves
// to a stub that reports the format as unsupported.
const noPdf = (): Plugin => ({
    name: 'oriel-no-pdf',
    enforce: 'pre',
    resolveId(source, importer) {
        if (source === './pdf.js' && importer?.replace(/\\/g, '/').includes('/vendor/foliate-js/')) {
            return '\0oriel-no-pdf'
        }
        return null
    },
    load(id) {
        if (id === '\0oriel-no-pdf') {
            return "export const makePDF = () => { throw new Error('PDF books are not supported yet') }"
        }
        return null
    },
})

export default defineConfig({
    // Relative asset URLs keep the reader working under a Jellyfin BaseUrl.
    base: './',
    define: {
        __ORIEL_VERSION__: JSON.stringify(version),
    },
    plugins: [noPdf()],
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
