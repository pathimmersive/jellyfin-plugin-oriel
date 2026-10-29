import './data.css'
import { downloadReadingData, importReadingData } from '../api/client'
import { serverBasePath } from '../base'
import { authorizationHeader, deviceId, loginUrl, readSession } from '../session/credentials'
import { saveDataReturnMarker } from '../session/return'
import { backHref, bookId, summarizeImport } from './summary'

declare const __ORIEL_VERSION__: string

const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const start = (): void => {
    const basePath = serverBasePath(location.pathname)
    const itemId = bookId(location.search)
    element<HTMLAnchorElement>('back').href = backHref(basePath, itemId)

    const session = readSession(localStorage, location.origin)
    if (!session) {
        // Sign in on the jellyfin-web login page; with the jellyfin-web
        // integration on, its launcher brings the user back here.
        saveDataReturnMarker(localStorage, itemId)
        location.replace(loginUrl(location.pathname))
        return
    }
    const authorization = authorizationHeader(session, deviceId(localStorage), __ORIEL_VERSION__)

    const download = element<HTMLAnchorElement>('download')
    const downloadError = element('download-error')
    download.addEventListener('click', event => {
        event.preventDefault()
        downloadError.hidden = true
        void downloadReadingData(basePath, authorization).then(file => {
            if (!file.ok) {
                downloadError.textContent = `Your reading data could not be downloaded (${file.reason}).`
                downloadError.hidden = false
                return
            }
            const url = URL.createObjectURL(file.blob)
            const save = document.createElement('a')
            save.href = url
            save.download = file.fileName
            document.body.append(save)
            save.click()
            save.remove()
            setTimeout(() => URL.revokeObjectURL(url), 60_000)
        })
    })

    const input = element<HTMLInputElement>('file')
    const fileName = element('file-name')
    const importButton = element<HTMLButtonElement>('import')
    const result = element('result')
    const badFile = element('bad-file')
    const importError = element('import-error')
    const clearOutcome = (): void => {
        result.hidden = true
        badFile.hidden = true
        importError.hidden = true
    }
    input.addEventListener('change', () => {
        const chosen = input.files?.[0]
        fileName.textContent = chosen?.name ?? 'No file chosen'
        importButton.disabled = !chosen
        clearOutcome()
    })

    importButton.addEventListener('click', () => {
        const chosen = input.files?.[0]
        if (!chosen) return
        importButton.disabled = true
        clearOutcome()
        void importReadingData(basePath, authorization, chosen).then(outcome => {
            importButton.disabled = false
            if (outcome.kind === 'rejected') {
                badFile.hidden = false
            } else if (outcome.kind === 'failed') {
                importError.textContent = `The file could not be imported (${outcome.reason}). Your places on this server have not changed.`
                importError.hidden = false
            } else {
                showResult(summarizeImport(outcome.result))
                result.hidden = false
            }
        })
    })
}

const showResult = (summary: ReturnType<typeof summarizeImport>): void => {
    const line = (id: string, text: string | null): void => {
        const item = element(id)
        item.hidden = text === null
        item.querySelector('span')!.textContent = text ?? ''
    }
    line('imported', summary.imported)
    line('kept', summary.kept)
    element('unmatched').hidden = summary.unmatchedLead === null
    element('unmatched-lead').textContent = summary.unmatchedLead ?? ''
    element('unmatched-books').replaceChildren(...summary.unmatched.map(book => {
        const item = document.createElement('li')
        const title = document.createElement('span')
        title.className = 'title'
        title.textContent = book.title
        const detail = document.createElement('span')
        detail.className = 'detail'
        detail.textContent = book.detail
        item.append(title, detail)
        return item
    }))
}

start()
