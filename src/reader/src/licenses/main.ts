// The Licenses page: Oriel's license and the third-party notices, the same
// texts the release zip carries. Every browser that loads the reader receives
// the code and fonts these notices cover, so the reader shows them too.
import '../data/data.css'
import './licenses.css'
import license from '../../../../LICENSE?raw'
import notices from '../../../../THIRD_PARTY_NOTICES.md?raw'
import { serverBasePath } from '../base'
import { backHref, bookId } from '../data/summary'

const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

element<HTMLAnchorElement>('back').href = backHref(serverBasePath(location.pathname), bookId(location.search))
element('license').textContent = license
element('notices').textContent = notices
