// @vitest-environment node
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import tseslint from 'typescript-eslint'
import { describe, expect, it } from 'vitest'
import { guards } from './guards.js'

// A selector that matches nothing fails silently, so every guard is checked on real code.
const eslint = new ESLint({
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  overrideConfigFile: true,
  overrideConfig: [
    {
      files: ['**/*.{ts,tsx}'],
      languageOptions: {
        parser: tseslint.parser,
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
    },
    ...guards,
  ],
})

async function ruleIds(code, filePath) {
  const [result] = await eslint.lintText(code, { filePath })
  return result.messages.map((message) => message.ruleId)
}

const SOURCE = 'src/A.tsx'
const TEST = 'src/A.test.tsx'

describe('browser dialogs', () => {
  it.each(["alert('x')", "confirm('x')", "window.prompt('x')"])('forbids %s', async (code) => {
    expect(await ruleIds(code, SOURCE)).toEqual(['no-alert'])
  })
})

describe.each([SOURCE, TEST])('dangerouslySetInnerHTML in %s', (filePath) => {
  it.each([
    '<div dangerouslySetInnerHTML={{ __html: x }} />',
    "createElement('div', { dangerouslySetInnerHTML: { __html: x } })",
  ])('forbids %s', async (code) => {
    expect(await ruleIds(code, filePath)).toEqual(['no-restricted-syntax'])
  })
})

describe('UI text', () => {
  it.each(['<p>שלום</p>', '<p>Hello</p>', '<input aria-label="שם" />'])(
    'forbids text written in JSX: %s',
    async (code) => {
      expect(await ruleIds(code, SOURCE)).toEqual(['no-restricted-syntax'])
    },
  )

  it.each(['<p>{he.tagline}</p>', '<input aria-label={he.tagline} />'])(
    'allows text from he.ts: %s',
    async (code) => {
      expect(await ruleIds(code, SOURCE)).toEqual([])
    },
  )

  it('allows text written in tests', async () => {
    expect(await ruleIds('<p>Hello</p>', TEST)).toEqual([])
  })
})

describe('Tailwind direction', () => {
  it.each([
    '<div className="ml-4" />',
    '<div className="md:pr-2" />',
    '<div className="-mr-1" />',
    '<div className="left-0" />',
    '<div className="text-right" />',
    '<div className="border-l" />',
    '<div className="rounded-r-lg" />',
    '<div className={`ml-${n}`} />',
  ])('forbids the physical class in %s', async (code) => {
    expect(await ruleIds(code, SOURCE)).toEqual(['no-restricted-syntax'])
  })

  it.each([
    '<div className="ms-4 pe-2 text-start start-0 border-s rounded-e-lg" />',
    "const tag = 'html'",
  ])('allows %s', async (code) => {
    expect(await ruleIds(code, SOURCE)).toEqual([])
  })
})
