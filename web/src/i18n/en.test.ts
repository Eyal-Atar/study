// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { en } from './en'

// What the dictionary does with counts (singular and plural) and with user content (a name that
// can be Hebrew is isolated, so it keeps its own order inside an English sentence). The exact text
// of every count is pinned here, so a change of wording shows up in the review.

const FSI = '⁨'
const PDI = '⁩'
// A Hebrew exam name with brackets and a digit: the case where bidi reordering bites.
const NAME = 'חדו״א 1 (מועד ב׳)'
const ISOLATED = `${FSI}${NAME}${PDI}`

describe('en: counts', () => {
  it.each([
    ['building.examTasks', en.building.examTasks, 0, '0 tasks'],
    ['building.examTasks', en.building.examTasks, 1, '1 task'],
    ['building.examTasks', en.building.examTasks, 2, '2 tasks'],
    ['building.blocks', en.building.blocks, 1, '1 study block on your calendar.'],
    ['building.blocks', en.building.blocks, 3, '3 study blocks on your calendar.'],
    ['building.unscheduled', en.building.unscheduled, 1, '1 task didn’t fit.'],
    ['building.unscheduled', en.building.unscheduled, 2, '2 tasks didn’t fit.'],
    ['replan.added', en.replan.added, 1, '1 new study block'],
    ['replan.added', en.replan.added, 4, '4 new study blocks'],
    ['replan.removed', en.replan.removed, 1, '1 block comes off the calendar'],
    ['replan.removed', en.replan.removed, 2, '2 blocks come off the calendar'],
    ['review.lead', en.review.lead, 1, '1 block went by without a mark. What happened with it?'],
    ['review.lead', en.review.lead, 3, '3 blocks went by without a mark. What happened with them?'],
    ['exam.list.count', en.exam.list.count, 1, '1 exam'],
    ['exam.list.count', en.exam.list.count, 2, '2 exams'],
    ['exam.analysis.replaced', en.exam.analysis.replaced, 1, '1 task will be replaced'],
    ['exam.analysis.replaced', en.exam.analysis.replaced, 2, '2 tasks will be replaced'],
    ['exam.analysis.kept', en.exam.analysis.kept, 0, 'No current task stays'],
    ['exam.analysis.kept', en.exam.analysis.kept, 1, '1 task stays as it is'],
    ['exam.analysis.kept', en.exam.analysis.kept, 2, '2 tasks stay as they are'],
    ['exam.analysis.added', en.exam.analysis.added, 1, '1 new task'],
    ['exam.analysis.added', en.exam.analysis.added, 2, '2 new tasks'],
    ['progress.streak.days', en.progress.streak.days, 1, '1 day'],
    ['progress.streak.days', en.progress.streak.days, 5, '5 days'],
    ['progress.level.blocksDone', en.progress.level.blocksDone, 0, 'No blocks done yet'],
    ['progress.level.blocksDone', en.progress.level.blocksDone, 1, '1 block done'],
    ['progress.level.blocksDone', en.progress.level.blocksDone, 12, '12 blocks done'],
    ['progress.days.summary', (n: number) => en.progress.days.summary(n, 30), 0, 'No study days in the last 30 days yet.'],
    ['progress.days.summary', (n: number) => en.progress.days.summary(n, 30), 1, '1 study day in the last 30 days.'],
    ['progress.days.summary', (n: number) => en.progress.days.summary(n, 30), 9, '9 study days in the last 30 days.'],
    ['onboardingMaterials.ready', en.onboardingMaterials.ready, null, 'Ready'],
    ['onboardingMaterials.ready', en.onboardingMaterials.ready, 1, 'Ready, 1 page'],
    ['onboardingMaterials.ready', en.onboardingMaterials.ready, 12, 'Ready, 12 pages'],
    ['onboardingSchedule.hours', en.onboardingSchedule.hours, 1, '1 hour'],
    ['onboardingSchedule.hours', en.onboardingSchedule.hours, 4, '4 hours'],
    ['settings.preferences.restDays', en.settings.preferences.restDays, 0, 'None'],
    ['settings.preferences.restDays', en.settings.preferences.restDays, 1, '1 day'],
    ['settings.preferences.restDays', en.settings.preferences.restDays, 5, '5 days'],
    ['exam.inDays', en.exam.inDays, 0, 'today'],
    ['exam.inDays', en.exam.inDays, 1, 'tomorrow'],
    ['exam.inDays', en.exam.inDays, 6, 'in 6 days'],
    ['exam.inDays', en.exam.inDays, -2, 'already passed'],
  ] as const)('%s(%s) = "%s"', (_name, fn, arg, expected) => {
    expect((fn as (n: number | null) => string)(arg as number | null)).toBe(expected)
  })

  it('the file count of an exam names zero, one and many', () => {
    expect(en.exam.materials.count(0)).toBe('No files')
    expect(en.exam.materials.count(1)).toBe('1 file')
    expect(en.exam.materials.count(3)).toBe('3 files')
  })

  it('the progress chip names the streak and the level', () => {
    expect(en.shell.progressChip(1, 4)).toBe('1-day streak, level 4')
    expect(en.shell.progressChip(12, 4)).toBe('12-day streak, level 4')
    expect(en.shell.progressChip(0, 1)).toBe('No streak yet, level 1')
  })

  it('limits of files and sizes have a text with the number and one without', () => {
    expect(en.codes.file_too_large(20)).toContain('20 MB')
    expect(en.codes.file_too_large(null)).not.toMatch(/\d/)
    expect(en.codes.too_many_materials(15)).toContain('15 files')
    expect(en.codes.too_many_materials(null)).not.toMatch(/\d/)
  })

  it('lengths of time: whole and half hours have their own words, the rest are numbers', () => {
    expect(en.report.hours(30)).toBe('half an hour')
    expect(en.report.hours(60)).toBe('1 hour')
    expect(en.report.hours(90)).toBe('1.5 hours')
    expect(en.report.hours(240)).toBe('4 hours')
    expect(en.settings.duration(60)).toBe('1 hour')
    expect(en.settings.duration(90)).toBe('1.5 hours')
    expect(en.settings.duration(30)).toBe('30 minutes')
  })
})

describe('en: user content in a sentence', () => {
  it.each([
    ['building.gap', en.building.gap(NAME, NAME)],
    ['exam.topics.gap', en.exam.topics.gap(NAME, NAME)],
  ])('%s isolates both the topic and the note', (_name, text) => {
    expect(text).toBe(`${ISOLATED}: ${ISOLATED}`)
  })

  it.each([
    ['onboardingExams.deleteExam', en.onboardingExams.deleteExam(NAME), `Delete ${ISOLATED}`],
    ['onboardingExams.deleted', en.onboardingExams.deleted(NAME), `Deleted ${ISOLATED}`],
    ['onboardingExams.restored', en.onboardingExams.restored(NAME), `Restored ${ISOLATED}`],
    ['onboardingMaterials.deleteNamed', en.onboardingMaterials.deleteNamed(NAME), `Delete: ${ISOLATED}`],
    ['onboardingMaterials.removeNamed', en.onboardingMaterials.removeNamed(NAME), `Remove: ${ISOLATED}`],
    ['onboardingMaterials.retryNamed', en.onboardingMaterials.retryNamed(NAME), `Try again: ${ISOLATED}`],
    ['board.completeLabel', en.board.completeLabel(NAME), `Done: ${ISOLATED}`],
    ['board.deferLabel', en.board.deferLabel(NAME), `Defer: ${ISOLATED}`],
    ['board.pinLabel', en.board.pinLabel(NAME), `Lock: ${ISOLATED}`],
    ['board.actionsLabel', en.board.actionsLabel(NAME), `Actions: ${ISOLATED}`],
    ['board.partName', en.board.partName(NAME, 'Part 1 of 2'), `${ISOLATED} (Part 1 of 2)`],
    ['report.shortfall', en.report.shortfall(NAME, '2 hours', null).slice(0, 40), `I’m 2 hours short for ${ISOLATED}`.slice(0, 40)],
  ])('%s wraps the name in an isolate', (_name, text, expected) => {
    expect(text).toBe(expected)
  })

  it('a name keeps its brackets and digit untouched inside the isolate', () => {
    const text = en.board.completeLabel(NAME)
    expect(text.startsWith(`Done: ${FSI}`)).toBe(true)
    expect(text.endsWith(PDI)).toBe(true)
    expect(text).toContain('(מועד ב׳)')
    expect(text).toContain(' 1 ')
  })

  // Every function of en.ts that receives user content, with its arguments (NAME where the user
  // content goes). The count check below fails when a new isolate() call appears in en.ts without a
  // row here.
  const NAMED: [string, (...args: string[]) => string, string[]][] = [
    ['onboardingExams.deleteExam', en.onboardingExams.deleteExam, [NAME]],
    ['onboardingExams.deleted', en.onboardingExams.deleted, [NAME]],
    ['onboardingExams.restored', en.onboardingExams.restored, [NAME]],
    ['onboardingMaterials.addFilesFor', en.onboardingMaterials.addFilesFor, [NAME]],
    ['onboardingMaterials.filesOf', en.onboardingMaterials.filesOf, [NAME]],
    ['onboardingMaterials.removeNamed', en.onboardingMaterials.removeNamed, [NAME]],
    ['onboardingMaterials.retryNamed', en.onboardingMaterials.retryNamed, [NAME]],
    ['onboardingMaterials.deleteNamed', en.onboardingMaterials.deleteNamed, [NAME]],
    ['onboardingMaterials.deleted', en.onboardingMaterials.deleted, [NAME]],
    ['onboardingMaterials.deleteFailed', en.onboardingMaterials.deleteFailed, [NAME]],
    ['board.completeLabel', en.board.completeLabel, [NAME]],
    ['board.deferLabel', en.board.deferLabel, [NAME]],
    ['board.pinLabel', en.board.pinLabel, [NAME]],
    ['board.actionsLabel', en.board.actionsLabel, [NAME]],
    ['board.partName', en.board.partName, [NAME, 'Part 1 of 2']],
    ['board.meta', en.board.meta, [NAME, 'Practice', '1.5 hours']],
    ['board.nextMeta', en.board.nextMeta, ['1.5 hours', NAME, 'Practice']],
    ['board.uncompleteLabel', en.board.uncompleteLabel, [NAME]],
    ['board.unpinLabel', en.board.unpinLabel, [NAME]],
    ['board.report.task', en.board.report.task, [NAME, '1.5 hours']],
    ['review.details', en.review.details, [NAME, 'Part 1 of 2']],
    ['review.completeLabel', en.review.completeLabel, [NAME]],
    ['review.moveTodayLabel', en.review.moveTodayLabel, [NAME]],
    ['review.skipLabel', en.review.skipLabel, [NAME]],
    ['review.skipped', en.review.skipped, [NAME]],
    ['move.moveLabel', en.move.moveLabel, [NAME]],
    ['move.dialogTitle', en.move.dialogTitle, [NAME]],
    ['move.handleLabel', en.move.handleLabel, [NAME]],
    ['exam.topics.editNamed', en.exam.topics.editNamed, [NAME]],
    ['exam.tasks.markDoneNamed', en.exam.tasks.markDoneNamed, [NAME]],
    ['exam.tasks.actionsNamed', en.exam.tasks.actionsNamed, [NAME]],
    ['exam.tasks.formLabel', en.exam.tasks.formLabel, [NAME]],
    ['exam.materials.kindLabel', en.exam.materials.kindLabel, [NAME]],
  ]

  it.each(NAMED)('%s isolates the name exactly once', (_path, fn, args) => {
    const text = fn(...args)
    expect(text).toContain(ISOLATED)
    // Nothing of the name outside the isolate.
    expect(text.split(ISOLATED).join('')).not.toContain(NAME)
    expect(text.split(FSI)).toHaveLength(2)
  })

  it('the function table above covers every isolate() call of en.ts', () => {
    const source = readFileSync(new URL('./en.ts', import.meta.url), 'utf8')
    const calls = source.split('\n').filter((line) => line.includes('${isolate(')).length
    // The gaps (two names on one line) and the shortfall (two lines, one function) are tested apart.
    const covered = NAMED.length + 2 /* the two gap functions */ + 2 /* the two shortfall lines */
    expect(calls).toBe(covered)
  })
})

describe('en: a day inside a sentence', () => {
  it('"Tomorrow" is lower case, a date keeps its capital', () => {
    expect(en.board.deferred('Tomorrow', '14:00')).toBe('I moved it to tomorrow at 14:00')
    expect(en.board.deferred('Today', '09:00')).toBe('I moved it to today at 09:00')
    expect(en.board.deferred('Sunday, 22 Nov', '14:00')).toBe('I moved it to Sunday, 22 Nov at 14:00')
  })
})
