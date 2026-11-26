import { icon, ICONS } from '../controls/icons'

/** A note at the bottom of the page, as the reader's notices are drawn, with an icon and an optional action. */
export const showNotice = (text: string, path = ICONS.info, action?: { label: string, run: () => void }): HTMLElement => {
    const notice = document.createElement('div')
    notice.className = 'notice'
    notice.setAttribute('role', 'status')
    notice.innerHTML = `${icon(path, 22)}<span></span>`
    notice.querySelector('span')!.textContent = text
    if (action) {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = action.label
        button.addEventListener('click', action.run)
        notice.append(button)
    }
    document.body.append(notice)
    return notice
}

/** A notice that goes by itself after a few seconds, replacing one with the same text: at the top of the page, over a sheet and the controls, and clear of their buttons. */
export const showBriefly = (text: string): void => {
    for (const shown of document.querySelectorAll('.notice')) {
        if (shown.querySelector('span')?.textContent === text) shown.remove()
    }
    const notice = showNotice(text)
    notice.classList.add('brief')
    setTimeout(() => notice.remove(), 8000)
}
