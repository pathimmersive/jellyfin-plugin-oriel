/**
 * The server's base path (a configured Jellyfin BaseUrl, or empty) for a
 * reader page path such as `/jf/Oriel/`.
 */
export const serverBasePath = (pathname: string): string => {
    const index = pathname.toLowerCase().lastIndexOf('/oriel')
    return index > 0 ? pathname.slice(0, index) : ''
}
