// User content (an exam name, a task title, a file name) can be in any language. Inside a plain
// string (an aria-label, a toast) there is no element to carry dir="auto", so the name is wrapped
// in First Strong Isolate and Pop Directional Isolate: a Hebrew name keeps its own order and does
// not reorder the English sentence around it. In JSX, use ui/UserText instead.
export const isolate = (text: string) => `⁨${text}⁩`
