// Checks exporting and importing reading data through the plugin's API on a
// running server: the export holds only the caller's own positions; importing
// keeps whichever position was saved last; a book whose id is unknown is
// matched by title and author; books that cannot be matched are reported; bad
// files are rejected. Configured by environment: ORIEL_BASE (server URL
// including any BaseUrl), ORIEL_TOKEN, ORIEL_ITEM_ID, ORIEL_OTHER_TOKEN (a
// second user's token) and ORIEL_OTHER_CFI (a position only that user saved).
// Exits non-zero on the first failed check.
const env = name => {
    const value = process.env[name]
    if (!value) {
        console.error(`FAIL: ${name} is not set`)
        process.exit(2)
    }
    return value
}

const base = env('ORIEL_BASE')
const itemId = env('ORIEL_ITEM_ID')
const header = token => `MediaBrowser Client="oriel-smoke", Device="smoke", DeviceId="oriel-smoke", Version="1.0.0", Token="${token}"`
const mine = header(env('ORIEL_TOKEN'))
const other = header(env('ORIEL_OTHER_TOKEN'))
const otherCfi = env('ORIEL_OTHER_CFI')

const fail = message => { throw new Error(message) }
const pass = message => console.log(`PASS: ${message}`)

const call = async (path, authorization, init = {}) => {
    const headers = { 'Content-Type': 'application/json', ...init.headers }
    if (authorization) headers.Authorization = authorization
    const response = await fetch(`${base}${path}`, { ...init, headers })
    const text = await response.text()
    let body = null
    try { body = JSON.parse(text) } catch { /* not JSON */ }
    return { status: response.status, headers: response.headers, text, body }
}
const exportData = authorization => call('/Oriel/Export', authorization)
const importData = (authorization, file) => call('/Oriel/Import', authorization, { method: 'POST', body: typeof file === 'string' ? file : JSON.stringify(file) })
const position = async () => (await call(`/Oriel/Positions/${itemId}`, mine)).body

const id = value => value.replaceAll('-', '').toLowerCase()
const later = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString()

let failed = false
try {
    const exported = await exportData(mine)
    if (exported.status !== 200) fail(`GET /Oriel/Export returned ${exported.status}`)
    if (!/attachment/i.test(exported.headers.get('content-disposition') ?? '')) fail('the export is not served as a download')
    const file = exported.body
    if (file?.format !== 'oriel-reading-data' || file.version !== 1 || !Array.isArray(file.positions)) {
        fail(`the export is not an Oriel reading data file: ${exported.text.slice(0, 200)}`)
    }
    const entry = file.positions.find(p => id(p.itemId) === id(itemId))
    if (!entry || !entry.cfi || !entry.title || !entry.fileName || !entry.savedAt) fail(`the export has no full entry for the test book: ${JSON.stringify(file.positions)}`)
    if (exported.text.includes(otherCfi)) fail("the export contains another user's position")
    pass(`GET /Oriel/Export downloads the caller's positions only (${file.positions.length}), with title '${entry.title}', authors and file name`)

    const current = await position()
    let result = await importData(mine, file)
    if (result.status !== 200 || result.body?.imported !== 0 || result.body?.kept !== file.positions.length) {
        fail(`re-importing the same file should keep everything: ${result.status} ${result.text}`)
    }
    if ((await position()).cfi !== current.cfi) fail('re-importing the same file changed the stored position')

    const older = { ...file, positions: [{ ...entry, cfi: 'epubcfi(/6/2!/4/2/1:0)', savedAt: later(entry.savedAt, -3_600_000) }] }
    result = await importData(mine, older)
    if (result.body?.kept !== 1 || (await position()).cfi !== current.cfi) fail(`an older imported position replaced a newer one: ${result.text}`)

    const newerCfi = 'epubcfi(/6/10!/4/2/1:0)'
    const newer = { ...file, positions: [{ ...entry, cfi: newerCfi, savedAt: later(entry.savedAt, 1) }] }
    result = await importData(mine, newer)
    if (result.body?.imported !== 1 || (await position()).cfi !== newerCfi) fail(`a newer imported position did not replace the stored one: ${result.text}`)
    pass('importing keeps whichever position was saved last, and importing the same file twice changes nothing')

    const titleCfi = 'epubcfi(/6/6!/4/2/1:0)'
    const moved = {
        ...file,
        positions: [
            { ...entry, itemId: '00000000000040008000000000000001', cfi: titleCfi, savedAt: later(entry.savedAt, 2) },
            { itemId: '00000000000040008000000000000002', title: 'A Book This Server Does Not Have', authors: ['Nobody'], fileName: 'missing.epub', cfi: 'epubcfi(/6/2!/4/2/1:0)', fraction: 0.1, savedAt: entry.savedAt },
        ],
    }
    result = await importData(mine, moved)
    if (result.body?.imported !== 1 || (await position()).cfi !== titleCfi) fail(`a position with an unknown id was not matched by title and author: ${result.text}`)
    const unmatched = result.body?.unmatched ?? []
    if (unmatched.length !== 1 || unmatched[0].title !== 'A Book This Server Does Not Have') fail(`the unmatched book was not reported: ${result.text}`)
    pass('a position whose id is unknown here is matched by title and author; a book the server does not have is reported, not guessed')

    for (const [label, bad] of [
        ['a file that is not an Oriel export', { format: 'something-else', version: 1, positions: [] }],
        ['a file from a newer version', { ...file, version: 99 }],
        ['a malformed file', '{"format": "oriel-reading-data", "positions": ['],
        ['a position with a fraction above 1', { ...file, positions: [{ ...entry, fraction: 1.5 }] }],
    ]) {
        result = await importData(mine, bad)
        if (result.status !== 400) fail(`importing ${label} returned ${result.status}, expected 400`)
    }
    if ((await position()).cfi !== titleCfi) fail('a rejected import changed the stored position')
    for (const [label, response] of [['export', await exportData(null)], ['import', await importData(null, file)]]) {
        if (response.status !== 401) fail(`${label} without a token returned ${response.status}, expected 401`)
    }
    if ((await exportData(other)).text.includes(titleCfi)) fail("another user's export contains this user's position")
    pass('bad files are rejected with 400 and change nothing; without a token both are 401')

    // The positions above are made up; put back the real one so later checks
    // open the book at a place that exists in it.
    result = await importData(mine, { ...file, positions: [{ ...entry, savedAt: later(entry.savedAt, 3) }] })
    if (result.body?.imported !== 1 || (await position()).cfi !== entry.cfi) fail(`the exported position could not be restored: ${result.text}`)
} catch (error) {
    console.error(`FAIL: ${error.message}`)
    failed = true
}
process.exit(failed ? 1 : 0)
