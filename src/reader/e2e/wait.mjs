// Waiting in the browser checks: for what a check expects, not for a fixed time.

// Resolves with what `check` returns once it is truthy, asking again every
// 50 ms. After `timeout` ms it throws `message`, or what `message` returns when
// it is a function (given the last value), so the failure names what never
// happened.
export const until = async (check, message, timeout = 10_000) => {
    const started = Date.now()
    for (;;) {
        const value = await check()
        if (value) return value
        if (Date.now() - started > timeout) throw new Error(typeof message === 'function' ? await message(value) : message)
        // How often to ask again; the wait ends as soon as the check holds.
        await new Promise(resolve => setTimeout(resolve, 50))
    }
}

// Starts watching for the reader's next move: foliate fires 'relocate' once a
// page turn, a jump or a scroll has finished, its animation included. Returns
// a function that waits for it, failing with `message`. Watch before the
// press that moves, so a quick move is not missed.
export const watchMove = async (page, message) => {
    await page.evaluate(() => {
        window.orielMoved = false
        document.querySelector('foliate-view').addEventListener('relocate', () => { window.orielMoved = true }, { once: true })
    })
    return (timeout = 10_000) => until(() => page.evaluate(() => window.orielMoved), message, timeout)
}

// Holds for `ms`, for the few checks where time itself is the point: a press
// held down, a gesture's pace, or a window in which nothing must happen. Each
// call says why on the line before it.
export const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
