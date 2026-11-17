// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs'
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
      lang: 'he',
      dir: 'rtl',
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
