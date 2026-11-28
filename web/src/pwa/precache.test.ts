// @vitest-environment node
/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Read from disk: the config is a build file, not a module the test should import (it loads the PWA plugin).
const config = readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8')
const distWorker = new URL('../../dist/sw.js', import.meta.url)

describe('precache', () => {
  it('precaches the fonts and the Archi drawings, so the calendar looks right without a network (S38)', () => {
    const match = /globPatterns:\s*\[([^\]]*)\]/.exec(config)
    if (match?.[1] === undefined) throw new Error('injectManifest.globPatterns is not set in vite.config.ts')
    expect(match[1]).toContain('woff2')
    expect(match[1]).toContain('webp')
  })

  it.skipIf(!existsSync(distWorker))('the built worker lists woff2 and webp files to precache', () => {
    const worker = readFileSync(distWorker, 'utf8')
    expect(worker).toMatch(/\.woff2"/)
    expect(worker).toMatch(/\.webp"/)
  })
})
