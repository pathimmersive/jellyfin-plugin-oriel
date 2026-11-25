import { addFont, readChoices, readFontFile, readFonts, readThemes, removeFontFamily, saveChoices, saveThemes } from '../api/client'
import { type ChosenOnServer, createChoices } from '../controls/choices'
import { createOwnFonts } from '../controls/fonts'
import { createOwnThemes } from '../controls/themes'
import { choicesOf, type Settings } from '../settings/settings'
import type { ReaderServer } from './server'

/** The theme and font chosen on any device; `settings` are this device's. */
export const chosenOn = ({ basePath, authorization, fetch }: ReaderServer, settings: Settings): ChosenOnServer => createChoices({
    load: () => readChoices(basePath, authorization, fetch),
    save: choices => saveChoices(basePath, authorization, choices, fetch),
    storage: localStorage,
    wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
}, choicesOf(settings))

/** The reader's own fonts. */
export const ownFontsOn = ({ basePath, authorization, fetch }: ReaderServer): ReturnType<typeof createOwnFonts> => createOwnFonts({
    load: () => readFonts(basePath, authorization, fetch),
    add: font => addFont(basePath, authorization, font, fetch),
    file: id => readFontFile(basePath, authorization, id, fetch),
    remove: family => removeFontFamily(basePath, authorization, family, fetch),
    url: font => URL.createObjectURL(font),
    forget: url => URL.revokeObjectURL(url),
})

/** The reader's own themes. */
export const ownThemesOn = ({ basePath, authorization, fetch }: ReaderServer): ReturnType<typeof createOwnThemes> => createOwnThemes({
    load: () => readThemes(basePath, authorization, fetch),
    save: list => saveThemes(basePath, authorization, list, fetch),
})
