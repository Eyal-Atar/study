// The UI rules of section 7.9 of the design doc, as lint errors.

// A Tailwind class with a physical direction, also behind a variant (md:pr-2) or as a negative (-mr-1):
// - any class with a left or right part: left-0, text-right, float-left, bg-left, origin-top-left;
// - the short forms: ml-/mr-, pl-/pr-, scroll-ml-/scroll-pr-, border-l/-r, rounded-l/-r/-tl/-tr/-bl/-br.
const PHYSICAL = String.raw`/(^|[\s:])-?(([a-z0-9]+-)*(left|right)|(scroll-)?[mp][lr]|border-[lr]|rounded-([lr]|[tb][lr]))(-|\s|$)/`

const NO_RAW_HTML_MESSAGE =
  'dangerouslySetInnerHTML is not allowed: it opens the door to XSS. Render the content as React elements, which React escapes.'

const NO_DOM_HTML_MESSAGE =
  'innerHTML, outerHTML and insertAdjacentHTML are not allowed: they parse a string as HTML, which opens the door to XSS. Render the content as React elements, which React escapes.'

const NO_RAW_HTML = [
  { selector: 'JSXAttribute[name.name="dangerouslySetInnerHTML"]', message: NO_RAW_HTML_MESSAGE },
  { selector: 'Property[key.name="dangerouslySetInnerHTML"]', message: NO_RAW_HTML_MESSAGE },
  { selector: 'Property[key.value="dangerouslySetInnerHTML"]', message: NO_RAW_HTML_MESSAGE },
  // Writing only: reading el.innerHTML parses nothing.
  { selector: 'AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]', message: NO_DOM_HTML_MESSAGE },
  { selector: 'CallExpression[callee.property.name="insertAdjacentHTML"]', message: NO_DOM_HTML_MESSAGE },
]

// A string with a letter, in Latin or Hebrew. A string without one, like {' '}, is not text.
const HAS_LETTER = String.raw`/[A-Za-z֐-׿]/`

// Attributes whose value the user reads, or hears from a screen reader.
const TEXT_ATTRIBUTE = String.raw`JSXAttribute[name.name=/^(alt|aria-label|aria-description|placeholder|title)$/]`

const TEXT_MESSAGE = 'UI text lives in src/i18n/he.ts. Add a key there and render it, for example <p>{he.tagline}</p>.'
const TEXT_ATTRIBUTE_MESSAGE =
  'UI text lives in src/i18n/he.ts. Add a key there and pass it, for example aria-label={he.tagline}.'

const LOGICAL_CLASS_MESSAGE =
  'The app is RTL, so physical directions flip. Use a logical Tailwind class: ms-/me-, ps-/pe-, start-/end-, text-start/text-end, float-start/float-end, border-s/border-e, rounded-s/rounded-e, rounded-ss/-se/-es/-ee, scroll-ms-/scroll-pe-. bg-, object- and origin- have no logical form: use a value without a side, like bg-center or origin-top.'

export const guards = [
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-alert': 'error',
      'no-restricted-syntax': [
        'error',
        ...NO_RAW_HTML,
        { selector: `JSXText[value=${HAS_LETTER}]`, message: TEXT_MESSAGE },
        // A string in braces among the children: <p>{'Hello'}</p>.
        {
          selector: `:matches(JSXElement, JSXFragment) > JSXExpressionContainer > Literal[value=${HAS_LETTER}]`,
          message: TEXT_MESSAGE,
        },
        { selector: `${TEXT_ATTRIBUTE} > Literal`, message: TEXT_ATTRIBUTE_MESSAGE },
        // aria-label={'שם'}
        {
          selector: `${TEXT_ATTRIBUTE} > JSXExpressionContainer > Literal[value=${HAS_LETTER}]`,
          message: TEXT_ATTRIBUTE_MESSAGE,
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
