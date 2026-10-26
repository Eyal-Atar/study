// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import type { ViteUserConfigExport } from 'vitest/config'
import config from './vite.config.ts'

async function resolve(exported: ViteUserConfigExport) {
  return typeof exported === 'function' ? exported({ command: 'serve', mode: 'test' }) : exported
}

afterEach(() => {
  vi.unstubAllEnvs()
})

// Google, Supabase and CORS_ORIGINS allow exactly http://localhost:5173, so another port must fail.
it('serves on port 5173 only', async () => {
  const resolved = await resolve(config)
  expect(resolved.server).toMatchObject({ port: 5173, strictPort: true })
})

// Every VITE_ value is bundled into the browser code. loadEnv reads the VITE_ variables of the shell too.
it('refuses to start when a VITE_ variable holds a Supabase secret key', async () => {
  vi.stubEnv('VITE_LEAK', 'sb_secret_x')
  await expect(resolve(config)).rejects.toThrow(/VITE_LEAK/)
})

it('starts when no VITE_ variable holds a secret key', async () => {
  vi.stubEnv('VITE_OTHER', 'not-a-secret')
  await expect(resolve(config)).resolves.toMatchObject({ server: { port: 5173 } })
})
