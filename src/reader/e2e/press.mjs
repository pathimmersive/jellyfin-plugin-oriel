// A click with the mouse, or with `touch` a tap, at a share of the book's
// width, halfway down. A tap is a touchstart and touchend built by hand in the
// frame showing the page, as iOS sends them: Playwright's touchscreen does not
// reach into frames, and desktop WebKit has no Touch constructor. Returns false
// when no frame shows the page.
export const press = async (page, share, touch) => {
    const rect = await page.locator('#book').boundingBox()
    if (!rect) return false
    const x = rect.x + rect.width * share
    const y = rect.y + rect.height / 2
    if (!touch) {
        await page.mouse.click(x, y)
        return true
    }
    return page.evaluate(async ({ x, y }) => {
        // The frame under the point: a comic's spread also holds a blank side.
        const under = document.querySelector('foliate-view').renderer.getContents().map(({ doc }) => {
            const element = doc?.defaultView?.frameElement
            return { doc, element, frame: element?.getBoundingClientRect() }
        }).find(({ frame }) => frame && frame.width > 0 && x >= frame.left && x <= frame.right && y >= frame.top && y <= frame.bottom)
        if (!under) return false
        const { doc, element, frame } = under
        // A comic's frame is scaled with a CSS transform; positions inside it are not.
        const scale = element.offsetWidth > 0 ? frame.width / element.offsetWidth : 1
        const clientX = (x - frame.left) / scale
        const clientY = (y - frame.top) / scale
        const target = doc.elementFromPoint(clientX, clientY) ?? doc.body
        const fire = (type, touches) => {
            const event = new Event(type, { bubbles: true, cancelable: true })
            const point = { identifier: 1, target, clientX, clientY, screenX: clientX, screenY: clientY }
            Object.defineProperty(event, 'touches', { value: touches ? [point] : [] })
            Object.defineProperty(event, 'changedTouches', { value: [point] })
            target.dispatchEvent(event)
        }
        fire('touchstart', true)
        await new Promise(resolve => setTimeout(resolve, 60))
        fire('touchend', false)
        return true
    }, { x, y })
}
