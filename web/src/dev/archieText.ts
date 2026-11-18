import type { ArchieMood } from '../archie/moods'

// The texts of the Archie section of the components page (S31, Task 8). Its own file, beside
// devText.ts, and its own entry of the table of contents, joined to SECTIONS in ComponentsPage.
export const ARCHIE_SECTIONS = [{ id: 'archie', title: 'ארצ׳י (Archie)' }] as const

export type ArchieSectionId = (typeof ARCHIE_SECTIONS)[number]['id']

export const archieText = {
  caption:
    'הדמות בגזירות נייר, בשישה מצבים. האיור לא מצויר מחדש: התנועה היא שכבה מעליו, רצה רק כשהכרטיס במסך, ונעצרת לגמרי למי שביקש פחות תנועה. עדיין לא מוצג באף מסך.',
  cards: 'card: האיור במסגרת על תכלת השחר, עם שכבת התנועה של המצב',
  scene: 'scene: ברוחב מלא (כאן: זרימה בגן הזן)',
  avatars: 'avatar: עיגול סביב הפנים, בלי תנועה. 40 פיקסלים כברירת מחדל, והאחרון 64 (size-16)',
  moods: {
    intentions: 'זריעת כוונות (intentions): טיפות ונבטים',
    eureka: 'רגע אאוריקה (eureka): הילה וניצוצות',
    wisdom: 'קליגרפיה של חוכמה (wisdom): דיו ועשן',
    flow: 'זרימה בגן הזן (flow): אדוות וענפים',
    rest: 'טקס התה (rest): אדים ועלי פריחה',
    joy: 'ארצ׳י מקבל אותך (joy): נשימה וזוהר',
  } satisfies Record<ArchieMood, string>,
}
