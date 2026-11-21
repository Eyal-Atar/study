import { enPwa } from '../i18n/enPwa'
import { PRODUCT_NAME } from '../product'

// The pure part of the service worker (src/sw.ts): what a push shows, and where a click goes.
// The payload comes from our worker (decision 11: title, body, url, tag), but anything that reaches
// the push endpoint is shown, so every field is checked and has a safe fallback.

const DEFAULT_PATH = '/today'
const ICON = '/icons/icon-192.png'
// Monochrome (white on transparent): Android draws only the alpha of a badge in the status bar.
const BADGE = '/icons/badge-96.png'

export interface PushView {
  title: string
  options: NotificationOptions
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function field(data: unknown, key: string): unknown {
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>)[key] : undefined
}

// Only a path on our own origin: one leading '/', not '//' or '/\' (browsers read both as another
// host), and no control characters. Anything else would let a payload open an arbitrary site.
function safePath(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_PATH
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
  if (!/^\/(?![/\\])/.test(value) || /[\u0000-\u001f\u007f]/.test(value)) return DEFAULT_PATH
  return value
}

export function readPushPayload(data: unknown): PushView {
  const tag = nonEmptyString(field(data, 'tag'))
  return {
    title: nonEmptyString(field(data, 'title')) ?? PRODUCT_NAME,
    options: {
      body: nonEmptyString(field(data, 'body')) ?? enPwa.pushFallbackBody,
      // The same tag replaces the earlier reminder of a block instead of stacking another one.
      ...(tag === undefined ? {} : { tag }),
      lang: 'en',
      dir: 'ltr',
      icon: ICON,
      badge: BADGE,
      data: { url: safePath(field(data, 'url')) },
    },
  }
}

// `data` is notification.data, which readPushPayload filled; it is checked again because the
// notification may be from an older version of the worker. The origin check is a second guard.
export function clickTarget(data: unknown, origin: string): string {
  const target = new URL(safePath(field(data, 'url')), origin)
  return target.origin === origin ? target.href : new URL(DEFAULT_PATH, origin).href
}
