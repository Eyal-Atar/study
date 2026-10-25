// @vitest-environment node
import { expect, it } from 'vitest'
import type { ViteUserConfigExport } from 'vitest/config'
import config from './vite.config.ts'

async function resolve(exported: ViteUserConfigExport) {
  return typeof exported === 'function' ? exported({ command: 'serve', mode: 'test' }) : exported
}

// Google, Supabase and CORS_ORIGINS allow exactly http://localhost:5173, so another port must fail.
it('serves on port 5173 only', async () => {
  const resolved = await resolve(config)
  expect(resolved.server).toMatchObject({ port: 5173, strictPort: true })
})
