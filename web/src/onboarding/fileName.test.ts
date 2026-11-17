import { describe, expect, it } from 'vitest'
import { splitFileName } from './fileName'

describe('splitFileName', () => {
  it('takes the extension off the name and gives it in capitals', () => {
    expect(splitFileName('מבחן מועד א 2025.pdf')).toEqual({ name: 'מבחן מועד א 2025', type: 'PDF' })
    expect(splitFileName('scan.final.JPG')).toEqual({ name: 'scan.final', type: 'JPG' })
  })

  it('a name without an extension is shown whole', () => {
    expect(splitFileName('סילבוס')).toEqual({ name: 'סילבוס', type: null })
  })

  it('a name that is only an extension is shown whole, never as an empty row', () => {
    expect(splitFileName('.pdf')).toEqual({ name: '.pdf', type: null })
    expect(splitFileName(' .pdf')).toEqual({ name: ' .pdf', type: null })
  })

  it('a dot that does not start an extension stays in the name', () => {
    expect(splitFileName('סיכום.')).toEqual({ name: 'סיכום.', type: null })
    expect(splitFileName('סיכום פרק 3.5 סופי')).toEqual({ name: 'סיכום פרק 3.5 סופי', type: null })
  })
})
