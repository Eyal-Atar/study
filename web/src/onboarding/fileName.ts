// A file name split for display: the row of a file shows the name without its extension, and the
// extension, in capitals, in the subtitle ("Past exam, PDF"). In a Hebrew row the extension of
// a name like "<Hebrew words> 2025.pdf" was drawn at the far side, glued to the number ("pdf.2025 <Hebrew words>"):
// that is the correct bidi order, so <bdi> could not fix it.
export interface FileNameParts {
  // What the row shows as the name. Never empty for a name that is not empty.
  name: string
  // 'PDF', 'JPG'; null when the name has no extension to take off.
  type: string | null
}

// An extension is short, made of letters and digits, and has a letter: a Hebrew name like "<chapter summary> 3.5 final" and
// "<chapter summary> 3.5" have a dot and no extension.
const EXTENSION = /^(?=.*[A-Za-z])[A-Za-z0-9]{1,5}$/

export function splitFileName(filename: string): FileNameParts {
  const dot = filename.lastIndexOf('.')
  const base = dot === -1 ? '' : filename.slice(0, dot).trim()
  const extension = dot === -1 ? '' : filename.slice(dot + 1)
  // No dot, a name that is only an extension (".pdf"), or a dot at the end: the full name, so the
  // row is never empty.
  if (base === '' || !EXTENSION.test(extension)) return { name: filename, type: null }
  return { name: base, type: extension.toUpperCase() }
}
