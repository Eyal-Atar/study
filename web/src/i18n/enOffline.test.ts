import { describe, expect, it } from 'vitest'
import { en } from './en'
import { enOffline } from './enOffline'

// The texts of the read-only state without a network (S38). The exact sentences are the plan's; this
// file holds them still.

const APOSTROPHE = String.fromCodePoint(0x2019)

const ALL: [string, string][] = [
  ['notice', enOffline.notice('11:20')],
  ['noticeNoTime', enOffline.noticeNoTime],
  ['announce', enOffline.announce],
  ['blockOnly', enOffline.blockOnly],
  ['notSaved', enOffline.notSaved],
  ['focusDone', enOffline.focusDone],
]

describe('enOffline', () => {
  it('is en.offline', () => {
    expect(en.offline).toBe(enOffline)
  })

  it('the notice is the sentence of the prototype, with the time it is given', () => {
    expect(enOffline.notice('11:20')).toBe(
      `You${APOSTROPHE}re offline. I${APOSTROPHE}m showing your calendar as of 11:20. You can act again once the connection is back.`,
    )
    expect(enOffline.notice('Sat, 21 Nov, 09:00')).toContain('as of Sat, 21 Nov, 09:00.')
  })

  it('every other text is exactly the plan’s', () => {
    expect(enOffline.noticeNoTime).toBe(`You${APOSTROPHE}re offline. You can act again once the connection is back.`)
    expect(enOffline.announce).toBe(`You${APOSTROPHE}re offline. Your calendar is read only until the connection is back.`)
    expect(enOffline.blockOnly).toBe(`You${APOSTROPHE}re offline, so I can only show this block for now.`)
    expect(enOffline.notSaved).toBe(
      `I don${APOSTROPHE}t have this saved on your device. I${APOSTROPHE}ll load it once the connection is back.`,
    )
    expect(enOffline.focusDone).toBe(
      `You${APOSTROPHE}re offline, so I can${APOSTROPHE}t mark this Done yet. Your session stays here until the connection is back.`,
    )
  })

  it.each(ALL)('%s is a calm sentence in the first person: a full stop, no "!", no straight apostrophe, Archi is not the subject', (_, text) => {
    expect(text.endsWith('.')).toBe(true)
    expect(text).not.toContain('!')
    expect(text).not.toContain("'")
    expect(text).not.toMatch(/\bArchi\b/)
  })

  it('the save error of Task 1 is still there, untouched', () => {
    expect(en.errors.offline).toBe(
      `You${APOSTROPHE}re offline, so I couldn${APOSTROPHE}t save that. Try again once the connection is back.`,
    )
  })
})
