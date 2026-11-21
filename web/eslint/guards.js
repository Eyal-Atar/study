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
const HAS_LETTER = String.raw`/[A-Za-z\u0590-\u05FF]/`

// Attributes whose value the user reads, or hears from a screen reader.
const TEXT_ATTRIBUTE = String.raw`JSXAttribute[name.name=/^(alt|aria-label|aria-description|placeholder|title)$/]`

const TEXT_MESSAGE = 'UI text lives in src/i18n/en.ts. Add a key there and render it, for example <p>{en.tagline}</p>.'
const TEXT_ATTRIBUTE_MESSAGE =
  'UI text lives in src/i18n/en.ts. Add a key there and pass it, for example aria-label={en.tagline}.'

const LOGICAL_CLASS_MESSAGE =
  'Layout follows the direction of the text, and user content can be right-to-left. Use a logical Tailwind class: ms-/me-, ps-/pe-, start-/end-, text-start/text-end, float-start/float-end, border-s/border-e, rounded-s/rounded-e, rounded-ss/-se/-es/-ee, scroll-ms-/scroll-pe-. bg-, object- and origin- have no logical form: use a value without a side, like bg-center or origin-top.'

// No emoji, anywhere (S39, audit section 2): every pictograph, the dingbats (the check mark and the
// cross among them), the miscellaneous symbols and the emoji selector. An icon is a component of
// src/ui/icons. The same ranges as src/test/sourceGuards.test.ts, which also reads comments and CSS.
const EMOJI = /[\p{Extended_Pictographic}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F000}-\u{1FAFF}]|\u{FE0F}/u

const EMOJI_MESSAGE =
  'No emoji and no symbol characters as icons. Use an icon component from src/ui/icons (for example <StreakLeafIcon />).'

const noEmoji = {
  meta: { type: 'problem', schema: [], messages: { emoji: EMOJI_MESSAGE } },
  create(context) {
    const check = (node, text) => {
      if (typeof text === 'string' && EMOJI.test(text)) context.report({ node, messageId: 'emoji' })
    }
    return {
      Literal: (node) => check(node, node.raw),
      TemplateElement: (node) => check(node, node.value.raw),
      JSXText: (node) => check(node, node.value),
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (EMOJI.test(comment.value)) context.report({ loc: comment.loc, messageId: 'emoji' })
        }
      },
    }
  },
}

const ICONS_MESSAGE =
  'Icons come from src/ui/icons, the one set of the product: Archi\'s own icons and the generic glyphs it re-exports. Import from there, not from lucide-react.'

export const guards = [
  {
    // Every file of the app, tests included.
    files: ['src/**/*.{ts,tsx}'],
    plugins: { archi: { rules: { 'no-emoji': noEmoji } } },
    rules: { 'archi/no-emoji': 'error' },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/ui/icons/**'],
    rules: {
      'no-restricted-imports': ['error', { paths: [{ name: 'lucide-react', message: ICONS_MESSAGE }] }],
    },
  },
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
        // aria-label={'Name'}
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
    // The dictionaries hold sentences, not class lists: "right now" and "left out" are English,
    // not physical directions. Everything else still applies to them.
    files: ['src/i18n/**/*.ts', 'src/dev/*Text.ts'],
    ignores: ['src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', ...NO_RAW_HTML],
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
