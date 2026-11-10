// The theme and font the user has chosen follow them to every browser, so a
// check that chooses them puts Light and Default back on the server before it
// starts and when it ends: the next check's fresh browser then opens as a new
// reader's would.
export const forgetChoices = (base, token) => fetch(`${base}/Oriel/Choices`, {
    method: 'PUT',
    headers: {
        Authorization: `MediaBrowser Client="oriel-e2e", Device="e2e", DeviceId="oriel-e2e-choices", Version="1.0.0", Token="${token}"`,
        'Content-Type': 'application/json',
    },
    body: JSON.stringify({ theme: 'light', font: 'Default' }),
})
