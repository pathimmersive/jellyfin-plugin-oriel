// The only module that knows how jellyfin-web stores its session. That storage
// is an internal detail of jellyfin-web, so a change there breaks only this file.
import { serverBasePath } from '../base'

const CREDENTIALS_KEY = 'jellyfin_credentials'
const WEB_DEVICE_ID_KEY = '_deviceId2'
const OWN_DEVICE_ID_KEY = 'oriel_device_id'

export interface Session {
    accessToken: string
    userId: string
}

interface StoredServer {
    AccessToken?: string
    UserId?: string
    DateLastAccessed?: number
    ManualAddress?: string
    LocalAddress?: string
    RemoteAddress?: string
}

const originOf = (address: string): string | null => {
    try {
        return new URL(address).origin
    } catch {
        return null
    }
}

/**
 * The signed-in session jellyfin-web stored for this server, or null when there
 * is none. Prefers a server entry whose address matches `origin`, then the most
 * recently used one.
 */
export const readSession = (storage: Pick<Storage, 'getItem'>, origin: string): Session | null => {
    let stored: unknown
    try {
        stored = JSON.parse(storage.getItem(CREDENTIALS_KEY) ?? 'null')
    } catch {
        return null
    }
    const servers = (stored as { Servers?: unknown } | null)?.Servers
    if (!Array.isArray(servers)) return null

    const usable = (servers as StoredServer[]).filter(s => s?.AccessToken && s.UserId)
    const sameOrigin = usable.filter(s =>
        [s.ManualAddress, s.LocalAddress, s.RemoteAddress].some(a => a && originOf(a) === origin))
    const [server] = (sameOrigin.length ? sameOrigin : usable)
        .sort((a, b) => (b.DateLastAccessed ?? 0) - (a.DateLastAccessed ?? 0))
    return server ? { accessToken: server.AccessToken!, userId: server.UserId! } : null
}

/**
 * The device id to send. Reuses jellyfin-web's so the server sees one device,
 * else keeps one of the reader's own.
 */
export const deviceId = (storage: Pick<Storage, 'getItem' | 'setItem'>): string => {
    const existing = storage.getItem(WEB_DEVICE_ID_KEY) ?? storage.getItem(OWN_DEVICE_ID_KEY)
    if (existing) return existing
    const created = randomId()
    storage.setItem(OWN_DEVICE_ID_KEY, created)
    return created
}

// A version 4 UUID. crypto.randomUUID exists only in secure contexts, and a
// Jellyfin server on a home network is often plain http, so use getRandomValues.
const randomId = (): string => {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** The Authorization header Jellyfin 12 accepts; legacy token headers are off by default. */
export const authorizationHeader = (session: Session, device: string, version: string): string => {
    const fields: [string, string][] = [
        ['Client', 'Oriel'],
        ['Device', 'Oriel Reader'],
        ['DeviceId', device],
        ['Version', version],
        ['Token', session.accessToken],
    ]
    return 'MediaBrowser ' + fields.map(([key, value]) => `${key}="${encodeURIComponent(value)}"`).join(', ')
}

/** The jellyfin-web login page for a reader page path, under any BaseUrl. */
export const loginUrl = (pathname: string): string => `${serverBasePath(pathname)}/web/#/login`
