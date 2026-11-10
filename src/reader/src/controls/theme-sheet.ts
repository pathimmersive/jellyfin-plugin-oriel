import { accentInk, type OwnTheme, type ThemeColours, THEME_NAME_LENGTH, THEME_ROLES } from '../settings/settings'
import type { OwnThemes, ThemeEdit } from './themes'

/** New theme, also Edit theme, in Preferences' place. */
export interface ThemeSheet {
    /** The sheet's body, which takes the place of Preferences' while it shows. */
    body: HTMLElement
    /** The Delete theme dialog, over everything. */
    dialog: HTMLElement
    /** Fills the sheet for a new theme from `start`, or to edit `editing`; its title. */
    open(editing: OwnTheme | null, start: ThemeColours): string
    /** Closes the Delete theme dialog when it is open; false when it was not. */
    closeDialog(): boolean
}

/** What the sheet does with a theme once it is kept or deleted. */
export interface ThemeSheetOptions {
    themes: OwnThemes
    /** The book's title, for the preview's header. */
    title: string
    /** The id of the reader's own theme in use, or null for a built-in one. */
    inUse(): string | null
    /** A theme saved: the id it is kept under, new or edited. */
    saved(id: string, added: boolean): void
    /** The theme in use was deleted. */
    deletedInUse(): void
    /** Back to Preferences. */
    done(): void
}

const PATHS = {
    back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
    bookmarkOn: 'M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z',
    trash: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
}
const icon = (path: string, size = 20): string =>
    `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor"><path d="${path}"/></svg>`

/** The words of the Delete theme dialog: its title and what it says will happen. */
export const deleteWords = (name: string, inUse: boolean): { title: string, body: string } => ({
    title: `Delete ${name}?`,
    body: inUse ? 'You are reading with this theme now, so Oriel will switch to Light.' : 'This theme will be removed from all your devices.',
})

/**
 * New theme and Edit theme, as the canvas's PhoneThemeNew and PhoneThemeEdit
 * draw them: a name, a live preview and the ten colours, then Delete theme
 * (when editing), Cancel and Save. Delete theme asks first, as DialogTheme
 * draws it.
 */
export const createThemeSheet = (options: ThemeSheetOptions): ThemeSheet => {
    const body = document.createElement('div')
    body.className = 'panel-body theme-sheet'
    body.hidden = true
    body.innerHTML = `<label class="field">Name<input type="text" maxlength="${THEME_NAME_LENGTH}" placeholder="My theme" autocomplete="off"></label>`
        + '<div class="preview" role="img" aria-label="Preview of the theme">'
        + `<div class="preview-header">${icon(PATHS.back, 18)}<span class="preview-title"></span><span class="preview-mark">${icon(PATHS.bookmarkOn, 18)}</span></div>`
        + '<div class="preview-page"><span>It is a truth <span class="preview-selection">universally acknowledged</span>, that a single man in possession of a good fortune must be in want of a wife.</span>'
        + '<span class="preview-separator"></span>'
        + '<span class="preview-chapters"><span class="secondary">Chapter I</span><span class="accent">Chapter II</span><span class="grayed">Coming later</span></span></div>'
        + '<div class="preview-buttons"><span class="button">Button</span><span class="selected">Selected</span></div></div>'
        + '<div class="roles"></div>'
        + '<p class="message" role="status"></p>'
        + `<div class="sheet-buttons"><button type="button" class="delete">${icon(PATHS.trash)}Delete theme</button><span class="spacer"></span><button type="button" class="cancel">Cancel</button><button type="button" class="save">Save</button></div>`
    body.querySelector('.preview-title')!.textContent = options.title
    const name = body.querySelector<HTMLInputElement>('input[type="text"]')!
    const preview = body.querySelector<HTMLElement>('.preview')!
    const message = body.querySelector<HTMLElement>('.message')!
    const remove = body.querySelector<HTMLButtonElement>('.delete')!
    const save = body.querySelector<HTMLButtonElement>('.save')!
    const roles = THEME_ROLES.map(([colour, roleName, use]) => {
        const row = document.createElement('label')
        row.className = 'role'
        row.innerHTML = '<span class="role-names"><span class="role-name"></span><span class="role-use"></span></span><span class="hex"></span><input type="color">'
        row.querySelector('.role-name')!.textContent = roleName
        row.querySelector('.role-use')!.textContent = use
        const picker = row.querySelector('input')!
        picker.setAttribute('aria-label', `${roleName} colour`)
        picker.dataset.colour = colour
        picker.addEventListener('input', () => show())
        body.querySelector('.roles')!.append(row)
        return { colour, picker, hex: row.querySelector<HTMLElement>('.hex')! }
    })
    const colours = (): ThemeColours => Object.fromEntries(roles.map(({ colour, picker }) => [colour, picker.value.toLowerCase()])) as unknown as ThemeColours
    // The preview and each colour's #rrggbb follow the pickers.
    const show = (): void => {
        const chosen = colours()
        for (const { colour, hex } of roles) hex.textContent = chosen[colour]
        for (const [colour, value] of Object.entries(chosen)) preview.style.setProperty(`--${colour}`, value)
        preview.style.setProperty('--accent-ink', accentInk(chosen.accent))
    }
    name.addEventListener('input', () => { save.disabled = !name.value.trim() })

    const dialog = document.createElement('div')
    dialog.id = 'theme-dialog'
    dialog.dataset.controls = ''
    dialog.hidden = true
    dialog.innerHTML = '<div role="alertdialog" aria-modal="true" aria-labelledby="theme-dialog-title" aria-describedby="theme-dialog-body">'
        + '<h2 id="theme-dialog-title"></h2><p id="theme-dialog-body"></p>'
        + '<div class="dialog-buttons"><button type="button" class="cancel">Cancel</button><button type="button" class="confirm danger">Delete</button></div></div>'
    const dialogCancel = dialog.querySelector<HTMLButtonElement>('.cancel')!
    const closeDialog = (): boolean => {
        if (dialog.hidden) return false
        dialog.hidden = true
        remove.focus()
        return true
    }
    dialogCancel.addEventListener('click', () => closeDialog())
    dialog.addEventListener('click', event => {
        if (event.target === dialog) closeDialog()
    })

    let editing: OwnTheme | null = null
    // The whole list as kept, with `change` applied to it.
    const keep = async (change: (list: ThemeEdit[]) => ThemeEdit[]): Promise<OwnTheme[] | null> => {
        message.textContent = ''
        const saved = await options.themes.save(change(options.themes.list()))
        if (!saved) message.textContent = 'Your theme could not be saved. Try again.'
        return saved
    }
    save.addEventListener('click', async () => {
        const entry = { name: name.value.trim(), ...colours() }
        if (!entry.name) return
        const before = new Set(options.themes.list().map(theme => theme.id))
        const target = editing?.id
        const saved = await keep(list => target ? list.map(theme => theme.id === target ? { id: target, ...entry } : theme) : [...list, entry])
        if (!saved) return
        const id = target ?? saved.find(theme => !before.has(theme.id))?.id
        if (id) options.saved(id, !target)
        options.done()
    })
    body.querySelector('.cancel')!.addEventListener('click', () => options.done())
    remove.addEventListener('click', () => {
        if (!editing) return
        const words = deleteWords(editing.name, options.inUse() === editing.id)
        dialog.querySelector('h2')!.textContent = words.title
        dialog.querySelector('p')!.textContent = words.body
        dialog.hidden = false
        dialogCancel.focus()
    })
    dialog.querySelector('.confirm')!.addEventListener('click', async () => {
        if (!editing) return
        const gone = editing.id
        const wasInUse = options.inUse() === gone
        dialog.hidden = true
        if (!await keep(list => list.filter(theme => theme.id !== gone))) return
        if (wasInUse) options.deletedInUse()
        options.done()
    })

    return {
        body,
        dialog,
        open(toEdit, start) {
            editing = toEdit
            name.value = toEdit?.name ?? ''
            save.disabled = !name.value.trim()
            remove.hidden = !toEdit
            message.textContent = ''
            for (const { colour, picker } of roles) picker.value = start[colour]
            show()
            return toEdit ? 'Edit theme' : 'New theme'
        },
        closeDialog,
    }
}
