import { describe, expect, it } from 'vitest'
import { authorizationHeader, deviceId, loginUrl, readSession } from '../src/session/credentials'
import { RETURN_KEY, saveReturnMarker } from '../src/session/return'

const ITEM = '3d180653ee958ef40e0ea24db3142dea'

const memoryStorage = (entries: Record<string, string> = {}) => {
    const map = new Map(Object.entries(entries))
    return {
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, value: string) => { map.set(key, value) },
        map,
    }
}

const withServers = (servers: unknown[]) =>
    memoryStorage({ jellyfin_credentials: JSON.stringify({ Servers: servers }) })

describe('readSession', () => {
    it('returns the token and user id of the stored server', () => {
        const storage = withServers([{ AccessToken: 'tok', UserId: 'user', ManualAddress: 'https://media.example' }])
        expect(readSession(storage, 'https://media.example')).toEqual({ accessToken: 'tok', userId: 'user' })
    })

    it('prefers the server whose address matches the page origin', () => {
        const storage = withServers([
            { AccessToken: 'other', UserId: 'u1', ManualAddress: 'https://other.example', DateLastAccessed: 200 },
            { AccessToken: 'mine', UserId: 'u2', LocalAddress: 'http://192.168.1.5:8096', DateLastAccessed: 100 },
        ])
        expect(readSession(storage, 'http://192.168.1.5:8096')?.accessToken).toBe('mine')
    })

    it('falls back to the most recently used server', () => {
        const storage = withServers([
            { AccessToken: 'old', UserId: 'u1', DateLastAccessed: 100 },
            { AccessToken: 'new', UserId: 'u2', DateLastAccessed: 200 },
        ])
        expect(readSession(storage, 'https://media.example')?.accessToken).toBe('new')
    })

    it('returns null when nothing is stored', () => {
        expect(readSession(memoryStorage(), 'https://media.example')).toBeNull()
    })

    it('returns null when no server has a token', () => {
        const storage = withServers([{ UserId: 'user', ManualAddress: 'https://media.example' }])
        expect(readSession(storage, 'https://media.example')).toBeNull()
    })

    it('returns null for unreadable credentials', () => {
        expect(readSession(memoryStorage({ jellyfin_credentials: '{not json' }), 'https://media.example')).toBeNull()
        expect(readSession(memoryStorage({ jellyfin_credentials: '{"Servers":{}}' }), 'https://media.example')).toBeNull()
    })
})

describe('authorizationHeader', () => {
    it('builds the MediaBrowser header with every field', () => {
        expect(authorizationHeader({ accessToken: 'abc123', userId: 'u' }, 'dev-1', '0.1.0')).toBe(
            'MediaBrowser Client="Oriel", Device="Oriel%20Reader", DeviceId="dev-1", Version="0.1.0", Token="abc123"')
    })
})

describe('deviceId', () => {
    it("reuses jellyfin-web's device id", () => {
        expect(deviceId(memoryStorage({ _deviceId2: 'web-device' }))).toBe('web-device')
    })

    it('creates and keeps its own when jellyfin-web has none', () => {
        const storage = memoryStorage()
        const first = deviceId(storage)
        expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
        expect(deviceId(storage)).toBe(first)
    })

    it('creates one on a plain http page, where crypto.randomUUID does not exist', () => {
        const original = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(crypto), 'randomUUID')!
        Object.defineProperty(Object.getPrototypeOf(crypto), 'randomUUID', { value: undefined, configurable: true })
        try {
            expect(deviceId(memoryStorage())).toMatch(/^[0-9a-f-]{36}$/)
        } finally {
            Object.defineProperty(Object.getPrototypeOf(crypto), 'randomUUID', original)
        }
    })
})

describe('loginUrl', () => {
    it('points at the jellyfin-web login page at the server root', () => {
        expect(loginUrl('/Oriel/')).toBe('/web/#/login')
    })

    it('keeps a configured BaseUrl', () => {
        expect(loginUrl('/jf/Oriel/')).toBe('/jf/web/#/login')
        expect(loginUrl('/media/jellyfin/oriel/')).toBe('/media/jellyfin/web/#/login')
    })

    it('asks jellyfin-web to return to the book detail page after sign-in', () => {
        const url = loginUrl('/jf/Oriel/', ITEM, 'server1')
        expect(url).toBe(`/jf/web/#/login?serverid=server1&url=${encodeURIComponent(`/details?id=${ITEM}&serverId=server1`)}`)
        const params = new URLSearchParams(url.split('?')[1])
        expect(decodeURIComponent(params.get('url')!)).toBe(`/details?id=${ITEM}&serverId=server1`)
    })

    it('returns to the detail page without a server id when it is not known', () => {
        expect(loginUrl('/Oriel/', ITEM, null)).toBe(`/web/#/login?url=${encodeURIComponent(`/details?id=${ITEM}`)}`)
    })
})

describe('saveReturnMarker', () => {
    const storage = () => {
        const items = new Map<string, string>()
        return { items, setItem: (key: string, value: string) => { items.set(key, value) } }
    }

    it('stores only the book id and the time', () => {
        const s = storage()
        expect(saveReturnMarker(s, ITEM, 1000)).toBe(true)
        expect(JSON.parse(s.items.get(RETURN_KEY)!)).toEqual({ id: ITEM, at: 1000 })
    })

    it('stores nothing for a missing or malformed id', () => {
        const s = storage()
        expect(saveReturnMarker(s, null)).toBe(false)
        expect(saveReturnMarker(s, '../../evil')).toBe(false)
        expect(saveReturnMarker(s, 'https://example.com/')).toBe(false)
        expect(s.items.size).toBe(0)
    })

    it('carries on when storage refuses the write', () => {
        expect(saveReturnMarker({ setItem: () => { throw new Error('quota') } }, ITEM)).toBe(false)
    })
})
