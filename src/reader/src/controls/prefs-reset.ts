import { resetLayout } from '../settings/settings'
import { element } from './elements'
import { icon, ICONS } from './icons'
import type { PrefsContext } from './prefs-section'

/** Reset to defaults and the dialog it asks in. */
export interface ResetChoice {
    button: HTMLButtonElement
    /** The dialog, over everything. */
    dialog: HTMLElement
    readonly shown: boolean
    close(): void
}

/** Reset to defaults asks first, in a dialog over everything. */
export const createReset = (context: PrefsContext): ResetChoice => {
    const button = element('button', { type: 'button', class: 'reset' }, `${icon(ICONS.reset)}<span>Reset to defaults</span>`)
    const layer = element('div', { id: 'reset-dialog', 'data-controls': '' })
    const dialog = element('div', { role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'reset-title', 'aria-describedby': 'reset-body' },
        '<h2 id="reset-title">Reset layout to the defaults?</h2><p id="reset-body"></p><div class="dialog-buttons"></div>')
    const cancel = element('button', { type: 'button', class: 'cancel' }, 'Cancel')
    const confirm = element('button', { type: 'button', class: 'confirm' }, 'Reset')
    dialog.querySelector('.dialog-buttons')!.append(cancel, confirm)
    layer.append(dialog)
    layer.hidden = true
    const close = (): void => {
        layer.hidden = true
        button.focus()
    }
    button.addEventListener('click', () => {
        dialog.querySelector('p')!.textContent = `Size, spacing, margins and page turn on this ${context.wide() ? 'computer' : 'phone'} go back to the defaults. Your themes, fonts and highlighters stay as they are.`
        layer.hidden = false
        cancel.focus()
    })
    cancel.addEventListener('click', close)
    layer.addEventListener('click', event => {
        if (event.target === layer) close()
    })
    confirm.addEventListener('click', () => {
        context.choose(resetLayout(context.settings()))
        close()
    })
    return {
        button,
        dialog: layer,
        get shown() {
            return !layer.hidden
        },
        close,
    }
}
