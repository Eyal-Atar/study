import { PRODUCT_NAME } from '../product'

export const he = {
  appName: PRODUCT_NAME,
  tagline: 'תוכנית לימודים יומית לתקופת המבחנים',
  common: { loading: 'טוען…', retry: 'לנסות שוב' },
  login: {
    google: 'התחברות עם Google',
    failed: 'לא הצלחנו להתחיל את ההתחברות. נסו שוב.',
  },
  callback: {
    working: 'מסיימים את ההתחברות…',
    failed: 'ההתחברות לא הושלמה. אפשר לנסות שוב.',
    backToLogin: 'חזרה למסך הכניסה',
  },
  home: {
    signedInAs: (email: string) => `התחברת בתור ${email}`,
    noEmail: 'התחברת בלי כתובת מייל',
    userId: 'מזהה משתמש',
    signOut: 'יציאה',
  },
  errors: {
    generic: 'משהו השתבש. נסו שוב בעוד רגע.',
    unreachable: 'לא הצלחנו להגיע לשרת. נסו שוב בעוד רגע.',
  },
  notFound: { title: 'הדף לא נמצא', backHome: 'לדף הבית' },
  config: {
    title: 'האפליקציה לא מוגדרת',
    body: 'חסרים משתני סביבה ב-web/.env, או שהערכים שלהם לא תקינים:',
  },
} as const
