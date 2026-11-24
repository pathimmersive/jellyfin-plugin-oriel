import { publicServerId } from '../api/client'
import { serverBasePath } from '../base'
import { loginUrl } from '../session/credentials'
import { saveReturnMarker } from '../session/return'

/** Signs in on the jellyfin-web login page, then comes back to this book. */
export const signIn = async (itemId: string | null): Promise<void> => {
    saveReturnMarker(localStorage, itemId)
    location.replace(loginUrl(location.pathname, itemId, await publicServerId(serverBasePath(location.pathname))))
}
