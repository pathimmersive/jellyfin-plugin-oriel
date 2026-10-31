// The fonts bundled with the reader: Latin WOFF2 files from Fontsource, under
// the SIL Open Font License (THIRD_PARTY_NOTICES.md). Vite serves each as a
// file of its own beside the reader, so nothing is loaded from another host.
import literata400Normal from '@fontsource/literata/files/literata-latin-400-normal.woff2?url'
import literata400Italic from '@fontsource/literata/files/literata-latin-400-italic.woff2?url'
import literata700Normal from '@fontsource/literata/files/literata-latin-700-normal.woff2?url'
import literata700Italic from '@fontsource/literata/files/literata-latin-700-italic.woff2?url'
import notoSerif400Normal from '@fontsource/noto-serif/files/noto-serif-latin-400-normal.woff2?url'
import notoSerif400Italic from '@fontsource/noto-serif/files/noto-serif-latin-400-italic.woff2?url'
import notoSerif700Normal from '@fontsource/noto-serif/files/noto-serif-latin-700-normal.woff2?url'
import notoSerif700Italic from '@fontsource/noto-serif/files/noto-serif-latin-700-italic.woff2?url'
import notoSans400Normal from '@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff2?url'
import notoSans400Italic from '@fontsource/noto-sans/files/noto-sans-latin-400-italic.woff2?url'
import notoSans700Normal from '@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff2?url'
import notoSans700Italic from '@fontsource/noto-sans/files/noto-sans-latin-700-italic.woff2?url'
import atkinsonHyperlegible400Normal from '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff2?url'
import atkinsonHyperlegible400Italic from '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-italic.woff2?url'
import atkinsonHyperlegible700Normal from '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-700-normal.woff2?url'
import atkinsonHyperlegible700Italic from '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-700-italic.woff2?url'

// The Latin range Fontsource cuts these files to; other characters fall back
// to the next font in the stack.
const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'

const FACES: [family: string, weight: number, style: string, url: string][] = [
    ['Literata', 400, 'normal', literata400Normal],
    ['Literata', 400, 'italic', literata400Italic],
    ['Literata', 700, 'normal', literata700Normal],
    ['Literata', 700, 'italic', literata700Italic],
    ['Noto Serif', 400, 'normal', notoSerif400Normal],
    ['Noto Serif', 400, 'italic', notoSerif400Italic],
    ['Noto Serif', 700, 'normal', notoSerif700Normal],
    ['Noto Serif', 700, 'italic', notoSerif700Italic],
    ['Noto Sans', 400, 'normal', notoSans400Normal],
    ['Noto Sans', 400, 'italic', notoSans400Italic],
    ['Noto Sans', 700, 'normal', notoSans700Normal],
    ['Noto Sans', 700, 'italic', notoSans700Italic],
    ['Atkinson Hyperlegible', 400, 'normal', atkinsonHyperlegible400Normal],
    ['Atkinson Hyperlegible', 400, 'italic', atkinsonHyperlegible400Italic],
    ['Atkinson Hyperlegible', 700, 'normal', atkinsonHyperlegible700Normal],
    ['Atkinson Hyperlegible', 700, 'italic', atkinsonHyperlegible700Italic],
]

/** The @font-face rules for the bundled fonts, with absolute URLs so they load inside the book's frames. */
export const fontFaces = (): string => FACES.map(([family, weight, style, url]) =>
    `@font-face { font-family: '${family}'; font-style: ${style}; font-weight: ${weight}; font-display: swap; src: url('${new URL(url, location.href).href}') format('woff2'); unicode-range: ${LATIN}; }`).join('\n')
