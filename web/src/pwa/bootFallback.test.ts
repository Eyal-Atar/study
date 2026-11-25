// The boot fallback is a classic inline script in index.html: it runs even when the app's modules
// fail to load or throw before React mounts (a white page otherwise). Here it runs in jsdom as the
// browser would, after vite.config.ts has filled in the texts.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { en } from '../i18n/en'
import { fillBootTexts } from './bootTexts'

// Read by path: Vite rewrites new URL('…html', import.meta.url) into an asset URL.
const html = fillBootTexts(readFileSync(join(process.cwd(), 'index.html'), 'utf8'))
// The fallback is the inline script that holds the texts; the theme boot script (S43) comes first, in <head>.
const script =
  [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? '').find((s) => s.includes('var texts')) ??
  ''

function boot(): void {
  const root = document.createElement('div')
  root.id = 'root'
  document.body.replaceChildren(root)
  // Runs the page's own inline script, as the browser does.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const run = new Function(script) as () => void
  run()
}

describe('the boot fallback in index.html', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('has its texts filled in from en.ts', () => {
    expect(script).not.toBe('')
    expect(html).not.toContain('%BOOT_TEXTS%')
  })

  it('shows the crash message, the errors and a reload button when the app never mounts', () => {
    boot()
    window.dispatchEvent(new ErrorEvent('error', { message: 'SyntaxError: Unexpected token' }))
    vi.advanceTimersByTime(8000)

    const root = document.getElementById('root')
    expect(root?.textContent).toContain(en.crash.title)
    expect(root?.textContent).toContain(en.crash.body)
    expect(root?.textContent).toContain('SyntaxError: Unexpected token')
    expect(root?.querySelector('button')?.textContent).toBe(en.crash.reload)
  })

  it('leaves a mounted app alone', () => {
    boot()
    document.getElementById('root')?.append(document.createElement('main'))
    vi.advanceTimersByTime(8000)
    expect(document.getElementById('root')?.textContent).not.toContain(en.crash.title)
  })

  it('writes an error as text, never as markup', () => {
    boot()
    window.dispatchEvent(new ErrorEvent('error', { message: '<img src=x onerror=alert(1)>' }))
    vi.advanceTimersByTime(8000)
    expect(document.querySelector('#root img')).toBeNull()
  })
})
