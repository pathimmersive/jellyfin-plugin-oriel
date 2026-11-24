import { addFont, readChoices, readFontFile, readFonts, readThemes, removeFontFamily, saveChoices, saveThemes } from '../api/client'
import { type ChosenOnServer, createChoices } from '../controls/choices'
import { createOwnFonts } from '../controls/fonts'
import { createOwnThemes } from '../controls/themes'
import { choicesOf, type Settings } from '../settings/settings'
import type { ReaderServer } from './server'

/** The theme and font chosen on any device; `settings` are this device's. */
export const chosenOn = ({ basePath, authorization }: ReaderServer, settings: Settings): ChosenOnServer => createChoices({
    load: () => readChoices(basePath, authorization),
    save: choices => saveChoices(basePath, authorization, choices),
    storage: localStorage,
    wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
}, choicesOf(settings))

/** The reader's own fonts. */
export const ownFontsOn = ({ basePath, authorization }: ReaderServer): ReturnType<typeof createOwnFonts> => createOwnFonts({
    load: () => readFonts(basePath, authorization),
    add: font => addFont(basePath, authorization, font),
    file: id => readFontFile(basePath, authorization, id),
    remove: family => removeFontFamily(basePath, authorization, family),
    url: font => URL.createObjectURL(font),
    forget: url => URL.revokeObjectURL(url),
})

/** The reader's own themes. */
export const ownThemesOn = ({ basePath, authorization }: ReaderServer): ReturnType<typeof createOwnThemes> => createOwnThemes({
    load: () => readThemes(basePath, authorization),
    save: list => saveThemes(basePath, authorization, list),
})
