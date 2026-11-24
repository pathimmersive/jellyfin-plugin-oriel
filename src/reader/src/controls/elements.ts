import { icon, ICONS } from './icons'

/** A new element with its attributes and the HTML inside it. */
export const element = <K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Record<string, string> = {}, html = ''): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag)
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value)
    node.innerHTML = html
    return node
}

/** A stepper's value between its Less and More buttons, with its name before them. */
export const stepper = (setting: string, name: string, down: HTMLButtonElement, up: HTMLButtonElement, className = 'stepper'): { row: HTMLElement, value: HTMLElement } => {
    const row = element('div', { class: className, 'data-setting': setting })
    const label = element('span', { class: 'stepper-name' })
    label.textContent = name
    const value = element('span', { class: 'value' })
    const controls = element('div', { class: 'stepper-controls' })
    controls.append(down, value, up)
    row.append(label, controls)
    return { row, value }
}

export const stepButton = (label: string, path: string): HTMLButtonElement =>
    element('button', { type: 'button', class: 'step', 'aria-label': label }, icon(path))

export const closeButton = (): HTMLButtonElement =>
    element('button', { type: 'button', class: 'icon-button', 'aria-label': 'Close' }, icon(ICONS.close))

/** A named group of choices in Preferences, and the row they go in. */
export const choiceGroup = (name: string): { box: HTMLElement, row: HTMLElement } => {
    const box = element('div', { role: 'group', 'aria-label': name, class: 'choices' })
    const label = element('span', { class: 'group-label' })
    label.textContent = name
    const row = element('div', { class: 'choice-row' })
    box.append(label, row)
    return { box, row }
}
