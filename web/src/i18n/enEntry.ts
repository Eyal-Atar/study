// The texts of the entry screens (sign-in, the legal pages, and the rest of the entry flow as S34
// fills them in). Wired into en.ts as en.entry.
export const enEntry = {
  // The agreement line under the sign-in button: the two names are links to /terms and /privacy.
  login: {
    // The letter in the white circle of the Google button.
    googleLetter: 'G',
    agreeBefore: 'By continuing you agree to the ',
    terms: 'terms of use',
    agreeAnd: ' and the ',
    privacy: 'privacy policy',
    agreeAfter: '.',
  },
  legal: {
    terms: 'Terms of use',
    privacy: 'Privacy policy',
    soon: 'I’m still writing this page.',
    back: 'Back to sign-in',
  },
} as const
