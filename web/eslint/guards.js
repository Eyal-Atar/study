// The UI rules of section 7.9 of the design doc, as lint errors.

// A Tailwind class with a physical direction, such as ml-4, md:pr-2, -mr-1, left-0 or text-right.
const PHYSICAL = String.raw`/(^|[\s:])-?(m[lr]|p[lr]|left|right|border-[lr]|rounded-[lr]|text-(left|right))(-|\s|$)/`

const NO_RAW_HTML_MESSAGE =
  'dangerouslySetInnerHTML is not allowed: it opens the door to XSS. Render the content as React elements, which React escapes.'

const NO_RAW_HTML = [
  { selector: 'JSXAttribute[name.name="dangerouslySetInnerHTML"]', message: NO_RAW_HTML_MESSAGE },
  { selector: 'Property[key.name="dangerouslySetInnerHTML"]', message: NO_RAW_HTML_MESSAGE },
]

const LOGICAL_CLASS_MESSAGE =
  'The app is RTL, so physical directions flip. Use a logical Tailwind class: ms-/me-, ps-/pe-, start-/end-, text-start/text-end, border-s/border-e, rounded-s/rounded-e.'

export const guards = [
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-alert': 'error',
      'no-restricted-syntax': [
        'error',
        ...NO_RAW_HTML,
        {
          selector: String.raw`JSXText[value=/[A-Za-z֐-׿]/]`,
          message: 'UI text lives in src/i18n/he.ts. Add a key there and render it, for example <p>{he.tagline}</p>.',
        },
        {
          selector: 'JSXAttribute[name.name=/^(alt|aria-label|aria-description|placeholder|title)$/] > Literal',
          message: 'UI text lives in src/i18n/he.ts. Add a key there and pass it, for example aria-label={he.tagline}.',
        },
        { selector: `Literal[value=${PHYSICAL}]`, message: LOGICAL_CLASS_MESSAGE },
        { selector: `TemplateElement[value.raw=${PHYSICAL}]`, message: LOGICAL_CLASS_MESSAGE },
      ],
    },
  },
  {
    // Tests may write text and classes directly, but never raw HTML.
    files: ['src/**/*.test.{ts,tsx}', 'src/test/**'],
    rules: {
      'no-restricted-syntax': ['error', ...NO_RAW_HTML],
    },
  },
]
