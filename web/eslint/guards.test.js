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

describe.each([SOURCE, TEST])('raw HTML in %s', (filePath) => {
  it.each([
    '<div dangerouslySetInnerHTML={{ __html: x }} />',
    "createElement('div', { dangerouslySetInnerHTML: { __html: x } })",
    "({ 'dangerouslySetInnerHTML': x })",
    'el.innerHTML = x',
    'el.outerHTML = x',
    "el.insertAdjacentHTML('beforeend', x)",
  ])('forbids %s', async (code) => {
    expect(await ruleIds(code, filePath)).toEqual(['no-restricted-syntax'])
  })

  // Only writing HTML is forbidden: reading it, or writing text, parses nothing.
  it.each(['const html = el.innerHTML', 'el.textContent = x'])('allows %s', async (code) => {
    expect(await ruleIds(code, filePath)).toEqual([])
  })
})

describe('UI text', () => {
  it.each([
    '<p>שלום</p>',
    '<p>Hello</p>',
    '<input aria-label="שם" />',
    "<p>{'Hello'}</p>",
    '<p>{"שלום"}</p>',
    "<>{'Hello'}</>",
    "<input aria-label={'שם'} />",
  ])('forbids text written in JSX: %s', async (code) => {
    expect(await ruleIds(code, SOURCE)).toEqual(['no-restricted-syntax'])
  })

  it.each([
    '<p>{en.tagline}</p>',
    '<input aria-label={en.tagline} />',
    // No letter: the space JSX needs between two elements.
    "<p>{' '}</p>",
    // className is not text the user reads.
    "<div className={'ms-4'} />",
  ])('allows %s', async (code) => {
    expect(await ruleIds(code, SOURCE)).toEqual([])
  })

  it.each(['<p>Hello</p>', "<p>{'Hello'}</p>", "<input aria-label={'שם'} />"])(
    'allows text written in tests: %s',
    async (code) => {
      expect(await ruleIds(code, TEST)).toEqual([])
    },
  )
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
    '<div className="float-left" />',
    '<div className="float-right" />',
    '<div className="clear-right" />',
    '<div className="bg-left" />',
    '<div className="object-right" />',
    '<div className="origin-top-left" />',
    '<div className="origin-bottom-right" />',
    '<div className="rounded-tl-lg" />',
    '<div className="rounded-br" />',
    '<div className="scroll-ml-2" />',
    '<div className="scroll-pr-4" />',
  ])('forbids the physical class in %s', async (code) => {
    expect(await ruleIds(code, SOURCE)).toEqual(['no-restricted-syntax'])
  })

  it.each([
    '<div className="ms-4 pe-2 text-start start-0 border-s rounded-e-lg" />',
    '<div className="float-start" />',
    '<div className="rounded-ss-lg" />',
    '<div className="scroll-ms-2" />',
    '<div className="origin-top" />',
    '<div className="bg-center" />',
    "const tag = 'html'",
  ])('allows %s', async (code) => {
    expect(await ruleIds(code, SOURCE)).toEqual([])
  })
})

describe('emoji', () => {
  // Written as code points, so this file holds no emoji either.
  const leaf = String.fromCodePoint(0x1f33f)
  const check = String.fromCodePoint(0x2713)
  const star = String.fromCodePoint(0x2b50)

  it.each([
    `const text = '${leaf} 12'`,
    `const text = \`${star} +50 XP\``,
    `<p>{'${check}'}</p>`,
    `<p>${leaf}</p>`,
    `// done ${check}\nconst x = 1`,
  ])('forbids an emoji or a symbol used as an icon: %#', async (code) => {
    expect(await ruleIds(code, SOURCE)).toContain('archi/no-emoji')
  })

  it('forbids it in tests too', async () => {
    expect(await ruleIds(`const name = '${leaf} x'`, TEST)).toEqual(['archi/no-emoji'])
  })

  it.each(["const range = '09:00–10:30'", "const text = 'Loading…'", "const name = 'חדו״א 1'"])(
    'allows punctuation and user content: %#',
    async (code) => {
      expect(await ruleIds(code, TEST)).toEqual([])
    },
  )
})

describe('icons', () => {
  it('forbids importing lucide-react outside src/ui/icons', async () => {
    expect(await ruleIds("import { Check } from 'lucide-react'\nexport const a = Check", SOURCE)).toEqual([
      'no-restricted-imports',
    ])
  })

  it('allows it inside src/ui/icons', async () => {
    expect(await ruleIds("export { Check } from 'lucide-react'", 'src/ui/icons/glyphs.ts')).toEqual([])
  })
})

describe('sentences in the dictionary', () => {
  it('are not read as Tailwind classes', async () => {
    expect(await ruleIds("export const en = { a: 'That can’t be done right now.' }", 'src/i18n/en.ts')).toEqual([])
  })

  it('but a class in a component still is', async () => {
    expect(await ruleIds("const c = 'text-right'", SOURCE)).toEqual(['no-restricted-syntax'])
  })
})
