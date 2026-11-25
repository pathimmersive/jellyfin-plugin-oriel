// ESLint for the reader's TypeScript: typescript-eslint's recommendedTypeChecked, every rule at error. No rule
// is turned off here; a finding that is a false positive is silenced on its own line, naming the rule and why:
//     // eslint-disable-next-line @typescript-eslint/<rule> -- why it is not a problem here
// Run it with `npm run lint` in src/reader, which installs what it needs in this folder. It is a package of its
// own because typescript-eslint needs TypeScript 6, while the reader builds with 7.
import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'

// A silencing names one line's rules and gives its reason.
const silenced = /^\s*eslint-disable-(?:next-line|line)\s+[@\w/-]+(?:,\s*[@\w/-]+)*\s+--\s+\S/
const reasons = {
    meta: { type: 'problem', schema: [] },
    create: context => ({
        Program() {
            for (const comment of context.sourceCode.getAllComments()) {
                if (/^\s*eslint(?:-|\s)/.test(comment.value) && !silenced.test(comment.value)) {
                    context.report({ loc: comment.loc, message: 'Silence a finding on its own line, naming the rule and, after --, why.' })
                }
            }
        },
    }),
}

export default defineConfig({
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: { parserOptions: { project: './tsconfig.json', tsconfigRootDir: `${import.meta.dirname}/..` } },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    plugins: { oriel: { rules: { reasons } } },
    rules: { 'oriel/reasons': 'error' },
})
