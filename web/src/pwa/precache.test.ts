// @vitest-environment node
/// <reference types="node" />
import { existsSync, readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Read from disk: the config is a build file, not a module the test should import (it loads the PWA plugin).
const configFile = new URL('../../vite.config.ts', import.meta.url)
const config = readFileSync(configFile, 'utf8')
const distWorker = new URL('../../dist/sw.js', import.meta.url)
// No build, or one older than the config: the worker on disk says nothing about the config now.
const freshBuild = existsSync(distWorker) && statSync(distWorker).mtimeMs >= statSync(configFile).mtimeMs

describe('precache', () => {
  it('precaches the fonts and the Archi drawings, so the calendar looks right without a network (S38)', () => {
    const match = /globPatterns:\s*\[([^\]]*)\]/.exec(config)
    if (match?.[1] === undefined) throw new Error('injectManifest.globPatterns is not set in vite.config.ts')
    expect(match[1]).toContain('woff2')
    expect(match[1]).toContain('webp')
  })

  it.skipIf(!freshBuild)('the built worker lists woff2 and webp files to precache', () => {
    const worker = readFileSync(distWorker, 'utf8')
    expect(worker).toMatch(/\.woff2"/)
    expect(worker).toMatch(/\.webp"/)
  })
})
