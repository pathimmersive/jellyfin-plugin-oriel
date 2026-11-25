const INFO = 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z'

/** A note at the bottom of the page, as the reader's notices are drawn, with an icon and an optional action. */
export const showNotice = (text: string, icon = INFO, action?: { label: string, run: () => void }): HTMLElement => {
    const notice = document.createElement('div')
    notice.className = 'notice'
    notice.setAttribute('role', 'status')
    notice.innerHTML = `<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="${icon}"/></svg><span></span>`
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
