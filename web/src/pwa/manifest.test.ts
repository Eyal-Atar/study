// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PRODUCT_NAME } from '../product'
import { manifest } from './manifest'

// Read from disk: Vitest does not load CSS content into tests.
const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

function color(name: string): string {
  const match = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)
  if (match?.[1] === undefined) throw new Error(`--color-${name} is not defined as #rrggbb`)
  return match[1]
}

describe('manifest', () => {
  it('names the app and opens it as a Hebrew RTL standalone app on /today', () => {
    expect(manifest).toMatchObject({
      name: PRODUCT_NAME,
      short_name: PRODUCT_NAME,
      lang: 'en',
      dir: 'ltr',
      display: 'standalone',
      start_url: '/today',
      scope: '/',
    })
  })

  // The manifest cannot read CSS variables, so the hex values are repeated; this keeps them in step.
  it('takes its colours from the theme', () => {
    expect(manifest.theme_color?.toLowerCase()).toBe(color('brand').toLowerCase())
    expect(manifest.background_color?.toLowerCase()).toBe(color('canvas').toLowerCase())
  })

  // index.html repeats the brand twice: the theme-color of the browser bar, and the reload button of
  // the boot fallback, which runs when the CSS may not have loaded.
  it('index.html takes the same brand colour', () => {
    // Read by path: Vite rewrites new URL('…html', import.meta.url) into an asset URL.
    const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8')
    const brand = color('brand').toLowerCase()
    expect(/<meta name="theme-color" content="(#[0-9a-fA-F]{6})"/.exec(html)?.[1]?.toLowerCase()).toBe(brand)
    expect(/background:(#[0-9a-fA-F]{6});color:#fff/.exec(html)?.[1]?.toLowerCase()).toBe(brand)
  })

  it('has a 192 and a 512 icon, and a maskable 512', () => {
    const icons = manifest.icons ?? []
    expect(icons).toContainEqual(expect.objectContaining({ sizes: '192x192', type: 'image/png', purpose: 'any' }))
    expect(icons).toContainEqual(expect.objectContaining({ sizes: '512x512', type: 'image/png', purpose: 'any' }))
    expect(icons).toContainEqual(
      expect.objectContaining({ sizes: '512x512', type: 'image/png', purpose: 'maskable' }),
    )
  })

  it('points every icon at a file in public/icons', () => {
    for (const icon of manifest.icons ?? []) {
      expect(() => readFileSync(new URL(`../../public${icon.src}`, import.meta.url))).not.toThrow()
    }
  })
})
