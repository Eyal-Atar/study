import { PRODUCT_NAME } from '../product'
import { isolate } from './bidi'
import { enCrash } from './enCrash'
import { enPwa } from './enPwa'

// Every text the user reads or hears, in Archi's voice (docs/design/archi-voice.md): Archi speaks
// in the first person (I / me / my) and addresses the user as "you". Never "Archi will", never the
// "we" of a company. One section per screen; shared pieces in `common`, `errors` and `codes`.
// A screen fills only its own section. A function that takes user content (an exam name, a task
// title, a file name) wraps it in isolate(), so a Hebrew name keeps its order inside the sentence.

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${String(n)} ${many}`)

// A count of days: "1 day", "5 days". Shared by the progress board and the progress chip.
const dayCount = (n: number) => plural(n, 'day', 'days')

// "Today", "Tomorrow" and "Yesterday" are titles on their own and lower case inside a sentence
// ("I moved it to tomorrow at 14:00."); a date ("Sun, 22 Nov") stays as it is.
const inSentence = (day: string) => (/^(Today|Tomorrow|Yesterday)$/.test(day) ? day.toLowerCase() : day)

export const en = {
  appName: PRODUCT_NAME,
  tagline: 'Tell me your exams and share your materials. I’ll build your study plan, day by day.',
  common: {
    loading: 'Loading…',
    retry: 'Try again',
    undo: 'Undo',
    close: 'Close',
    next: 'Next',
    back: 'Back',
    skip: 'Skip',
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    notifications: 'Messages',
    // S26
    choose: 'Choose',
  },
  // S16: the crash screen (AppErrorBoundary, and the boot fallback in index.html); texts in enCrash.ts.
  crash: enCrash,
  shell: {
    signOut: 'Sign out',
    mainNav: 'Main navigation',
    // S31: the calendar is the home destination (it replaced "today" and "week").
    calendar: 'Calendar',
    // S15
    exams: 'Exams',
    settings: 'Settings',
    // S19
    progress: 'Progress',
    // S26
    skipToContent: 'Skip to content',
    profile: 'Profile',
    // S31: the name of the progress chip in the header, a link to the progress board.
    progressChip: (streak: number, level: number) =>
      streak === 0 ? `No streak yet, level ${String(level)}` : `${String(streak)}-day streak, level ${String(level)}`,
  },
  // S31: the temporary /calendar, which shows the day or the week (S32 replaces it).
  calendar: {
    view: 'View',
    day: 'Day',
    week: 'Week',
  },
  login: {
    google: 'Continue with Google',
    failed: 'I couldn’t start the sign-in. Please try again.',
  },
  callback: {
    title: 'Signing in',
    working: 'Finishing your sign-in…',
    failed: 'The sign-in didn’t complete. You can try again.',
    backToLogin: 'Back to sign-in',
  },
  errors: {
    generic: 'Something went wrong. Please try again in a moment.',
    unreachable: 'I couldn’t reach the server. Please try again in a moment.',
  },
  // The text of every code the API, the worker and the planner send (codes.ts reads it).
  // A function takes the problem's extra fields, already checked by codes.ts.
  codes: {
    // API problems
    unauthenticated: 'Please sign in again.',
    not_found: 'I couldn’t find that.',
    validation_error: 'Some of the details aren’t valid. Check them and try again.',
    database_unavailable: 'I’m not available right now. Please try again in a moment.',
    plan_conflict: 'That change clashes with another block. Refresh and try again.',
    stale_plan: 'Your plan changed in the meantime. I’m showing the latest version.',
    placement_failed: 'I couldn’t find a free spot for this task. You can ask me to replan your calendar.',
    invalid_state: 'That can’t be done right now.',
    nothing_to_undo: 'There’s nothing to undo.',
    dependency_cycle: 'That would make tasks depend on each other in a loop.',
    exam_in_past: 'That exam date has already passed. Pick a future date.',
    network: 'I couldn’t reach the server. Check your connection and try again.',
    timeout: 'The server took too long to answer. Please try again in a moment.',
    // Materials (S10)
    file_missing: 'The file didn’t reach me. Try uploading it again.',
    file_too_large: (limitMb: number | null) =>
      limitMb === null ? 'That file is too large.' : `That file is too large. I can take up to ${String(limitMb)} MB.`,
    unsupported_file: 'I can read PDF, JPG and PNG files only.',
    pdf_unreadable: 'I couldn’t read that PDF. It may be damaged or password-protected.',
    storage_unavailable: 'File storage isn’t available right now. Please try again in a moment.',
    material_missing: 'The file was deleted before I finished reading it.',
    internal_error: 'Something went wrong on my side. Please try again later.',
    worker_crashed: 'I was interrupted halfway. Please try again.',
    unknown_kind: 'Something went wrong on my side. Please try again later.',
    pages_truncated: 'That file is long, so I read only its first pages.',
    text_truncated: 'Some of the text is very long, so I read only its beginning.',
    too_many_materials: (limit: number | null) =>
      limit === null
        ? 'This exam has reached its file limit. Delete a file to add another.'
        : `An exam can have up to ${String(limit)} files. Delete one (a failed one counts too) to add another.`,
    already_exists: 'That file is already here.',
    // Course analysis (S11)
    exam_missing: 'The exam was deleted before I finished analysing it.',
    already_analyzed: 'I’ve already analysed this exam.',
    no_study_time:
      'There’s no study time before this exam. Check its date and your study hours, or whether your me time covers them.',
    analysis_invalid: 'I couldn’t build tasks from this exam’s materials. Please try again.',
    ai_unavailable: 'I’m handling a lot right now. Please try again in a few minutes.',
    ai_rejected: 'I couldn’t work with those materials. Try uploading different files.',
    ai_refused: 'I can’t process those materials.',
    ai_not_configured: 'Analysis isn’t set up right now. Please try again later.',
    response_truncated: 'The analysis was cut off halfway. Please try again.',
    // Analysis warnings (S11)
    under_budget: 'Your materials need less time than you have, so some time stays free.',
    trimmed_to_budget: 'There were more tasks than time, so I left out some of the practice.',
    materials_not_ready: 'Some files weren’t ready yet, so I didn’t include them.',
    scanned_pages_skipped: 'There were too many scanned pages, so I left some of them out.',
    budget_raised_to_minimum: 'The essential tasks need more time than you have before the exam, so your plan is tight.',
    // Plan generation (S12)
    ai_no_credit: 'Analysis isn’t available right now. It’s being fixed, so please try again later.',
    ai_quota_exceeded: (resetsAt: string | null) =>
      resetsAt === null
        ? 'You’ve reached today’s limit for building plans. You can try again tomorrow.'
        : `You’ve reached today’s limit for building plans. You can try again after ${resetsAt}.`,
    nothing_to_analyze: 'I’ve already analysed all your exams. You can ask me to replan your calendar.',
    materials_processing: 'I’m still reading the files you uploaded.',
    // Planner reasons: why a task is not on the calendar (S06–S08)
    no_study_days: 'There are no study days before the exam.',
    not_enough_time: 'There isn’t enough time before the exam.',
    no_contiguous_window: 'There’s no unbroken stretch of time long enough.',
    dependency_not_scheduled: 'The task it depends on isn’t on the calendar.',
    dependency_too_late: 'The task it depends on ends too late.',
    longer_than_daily_minutes: 'It’s longer than your daily study time.',
    dependent_too_early: 'A task that depends on it is already scheduled earlier.',
    // S18: the morning review and moving a block within its day
    no_time_today: 'There’s no free spot today that fits the whole task.',
    slot_taken: 'Another block already has that time.',
    outside_day: 'A block can only move to a free time later the same day.',
    // Push reminders (S16)
    push_endpoint_invalid: 'This browser gave me a reminder address I can’t use. Try a different browser.',
  },
  // "Did not fit" reports, with the exam name (codes.ts).
  report: {
    cycle: 'It’s part of a loop of tasks that depend on each other.',
    hours: (minutes: number) => {
      const hours = Math.round((minutes / 60) * 2) / 2
      if (hours <= 0.5) return 'half an hour'
      if (hours === 1) return '1 hour'
      return `${String(hours)} hours`
    },
    shortfall: (exam: string, missing: string, daily: string | null) =>
      daily === null
        ? `I’m ${missing} short for ${isolate(exam)}. You can drop tasks, add study time or move the exam.`
        : `I’m ${missing} short for ${isolate(exam)}. You can raise your daily study time to ${daily}, or drop tasks.`,
  },
  notFound: { title: 'Page not found', body: 'This address doesn’t exist, or the page has moved.', backHome: 'Back to home' },
  config: {
    title: 'The app isn’t configured',
    body: 'Environment variables are missing from web/.env, or their values aren’t valid:',
  },
  // S13
  onboarding: {
    stepOf: (step: number, total: number) => `Step ${String(step)} of ${String(total)}`,
    stepsLabel: 'Setup steps',
    steps: ['Exams', 'Materials', 'Questions', 'Your plan'],
    // S28: the one button of steps 1 and 2 (step 3 says what it starts: "Build my plan").
    continue: 'Continue',
  },
  onboardingExams: {
    title: 'Hi, I’m Archi. What exams are we preparing for?',
    intro: 'Add each exam with its date and how hard it feels to you. You can change all of this later.',
    name: 'Exam name',
    namePlaceholder: 'For example: Algorithms',
    nameRequired: 'Give the exam a name.',
    nameTooLong: 'That name is too long. Keep it under 200 characters.',
    date: 'Exam date',
    dateRequired: 'Pick a full date for the exam.',
    dateTooEarly: 'Pick a date from tomorrow onwards.',
    dateTooLate: 'Pick a date within two years from today.',
    difficulty: 'How hard does this exam feel to you?',
    difficultyLevels: ['Very easy', 'Easy', 'Medium', 'Hard', 'Very hard'],
    add: 'Add exam',
    listTitle: 'Your exams',
    empty: 'No exams yet',
    deleteExam: (name: string) => `Delete ${isolate(name)}`,
    deleted: (name: string) => `Deleted ${isolate(name)}`,
    restored: (name: string) => `Restored ${isolate(name)}`,
    difficultyOf: (label: string) => `Difficulty: ${label.toLowerCase()}`,
    // The subtitle of an exam's row: "20 January 2027. Difficulty: hard".
    details: (date: string, difficulty: string) => `${date}. Difficulty: ${difficulty.toLowerCase()}`,
  },
  onboardingMaterials: {
    title: 'Do you have materials from your courses?',
    intro: 'They’re optional, but with them I can fit the plan to your course. Past exams with solutions help me the most.',
    // S28: the same button as "Continue", when no exam has a file: the skip is said in the button itself.
    continueWithout: 'Continue without materials',
    privacy: 'Your files are sent to Anthropic for processing, so I can build tasks from them.',
    fileTypes: 'PDF, JPG or PNG, up to 20 MB per file and 15 files per exam.',
    addFiles: 'Add files',
    // Starts with the visible text, so a screen reader user and a voice control user find the same button.
    addFilesFor: (exam: string) => `Add files for ${isolate(exam)}`,
    filesOf: (exam: string) => `Files for ${isolate(exam)}`,
    empty: 'No files for this exam yet.',
    noExams: 'No exams yet',
    noExamsHint: 'Go back a step to add an exam.',
    // The start of a file's subtitle, before its status: "Past exam, PDF." The kind is missing when a
    // control shows it, and the type when the name has no extension.
    fileLead: (kind: string | null, type: string | null) => {
      const parts = [kind, type].filter((part) => part !== null)
      return parts.length === 0 ? '' : `${parts.join(', ')}.`
    },
    uploading: 'Uploading…',
    processing: 'Reading the file…',
    ready: (pages: number | null) => (pages === null ? 'Ready' : `Ready, ${plural(pages, 'page', 'pages')}`),
    remove: 'Remove',
    removeNamed: (name: string) => `Remove: ${isolate(name)}`,
    retryNamed: (name: string) => `Try again: ${isolate(name)}`,
    deleteNamed: (name: string) => `Delete: ${isolate(name)}`,
    deleted: (name: string) => `Deleting ${isolate(name)}`,
    deleteFailed: (name: string) => `I couldn’t delete ${isolate(name)}.`,
    kinds: {
      syllabus: 'Syllabus',
      summary: 'Summary',
      past_exam: 'Past exam',
      solution: 'Solution',
      notes: 'Notes',
      other: 'Other',
    },
  },
  onboardingSchedule: {
    title: 'Two more questions',
    intro: 'I’ll use your answers to schedule study at the hours that suit you.',
    hoursQuestion: 'How many hours a day feels realistic for you?',
    hours: (hours: number) => plural(hours, 'hour', 'hours'),
    windowsQuestion: 'When do you like to study?',
    windowsHint: 'You can pick more than one.',
    windows: {
      morning: { label: 'Morning', range: '06:00–12:00' },
      afternoon: { label: 'Afternoon', range: '12:00–17:00' },
      evening: { label: 'Evening', range: '17:00–21:00' },
      night: { label: 'Night', range: '21:00–02:00' },
    },
    windowsRequired: 'Pick at least one time of day.',
    nightNote: 'The night before an exam or a rest day ends at midnight.',
    build: 'Build my plan',
  },
  building: {
    title: 'I’m building your plan',
    intro: 'This takes a few minutes. You can close the page: I’ll keep working, and your plan will be waiting when you’re back.',
    waitingMaterials: 'Reading your files…',
    starting: 'Getting started…',
    progressLabel: 'Plan building progress',
    // The stages of generate_plan (spec 7.8). An unknown stage shows `starting`.
    stages: {
      reading_materials: 'Reading your materials',
      analyzing: 'Studying the material and building tasks',
      validating: 'Checking the tasks',
      saving: 'Saving the tasks',
      planning: 'Placing the tasks on your calendar',
    },
    doneTitle: 'Your plan is ready',
    examsTitle: 'Exams',
    unknownExam: 'Exam',
    examTasks: (count: number) => plural(count, 'task', 'tasks'),
    examSkipped: 'Not analysed this time. Its current tasks stay.',
    examFailed: 'Not analysed:',
    someFailed: 'I couldn’t analyse some of your exams. I built the plan from the rest, and you can try again later.',
    gapsTitle: 'Topics with no material',
    blocks: (count: number) => `${plural(count, 'study block', 'study blocks')} on your calendar.`,
    unscheduled: (count: number) => (count === 1 ? '1 task didn’t fit.' : `${String(count)} tasks didn’t fit.`),
    toToday: 'Go to my calendar',
    failedTitle: 'I couldn’t build your plan',
    scheduleAnalyzed: 'Schedule what’s already analysed',
    replanReason: 'I can place the tasks of the exams I’ve already analysed on your calendar.',
  },
  replan: {
    title: 'Replan your calendar',
    loading: 'Working out what would change…',
    added: (count: number) => plural(count, 'new study block', 'new study blocks'),
    removed: (count: number) => (count === 1 ? '1 block comes off the calendar' : `${String(count)} blocks come off the calendar`),
    noChange: 'Your calendar is already up to date. Nothing to change.',
    nothingToSchedule: 'There’s nothing to schedule yet: no exam has tasks.',
    unscheduledTitle: 'What didn’t fit',
    unscheduledGroup: (count: number, reason: string) => `${plural(count, 'task', 'tasks')}: ${reason}`,
    confirm: 'Confirm',
    notNow: 'Not now',
    // The only button when there is nothing to apply. Not "Close": the dialog's own close button
    // has that name, and two buttons must not share one.
    understood: 'Got it',
    applied: 'Calendar updated',
    timezoneChanged: 'I updated your time zone to match this device. It’s worth replanning your calendar so your blocks match local time.',
    timezoneReason: 'Your device’s time zone changed, so your study windows moved.',
    showChange: 'Show the change',
  },
  // S14: the pieces that the day and the week share (web/src/board).
  board: {
    kinds: {
      learn: 'Learning',
      practice: 'Practice',
      review: 'Review',
      simulation: 'Simulation',
      simulation_review: 'Simulation review',
      custom: 'Task',
    },
    states: {
      in_progress: 'Now',
      overdue: 'Overdue',
      done: 'Done',
      missed: 'Missed',
      skipped: 'Skipped',
    },
    part: (index: number, count: number) => `Part ${String(index)} of ${String(count)}`,
    // blockName (blockName.ts): two parts of one task on one day must not share a button name.
    partName: (title: string, part: string) => `${isolate(title)} (${part})`,
    // S27: the subtitle of a block's row (BlockRow): "Probability, Practice. 1 hour". Commas and full
    // stops, never a middle dot (design language 5.2).
    meta: (exam: string, kind: string, duration: string) => `${isolate(exam)}, ${kind}. ${duration}`,
    // The same in the "next" card (NextBlock), after the time range: ", 1.5 hours. Algorithms, Learning".
    nextMeta: (duration: string, exam: string, kind: string) => `, ${duration}. ${isolate(exam)}, ${kind}`,
    // A split task adds its part to either line: ". Part 1 of 2".
    metaPart: (part: string) => `. ${part}`,
    pinned: 'Locked',
    complete: 'Done',
    uncomplete: 'Mark as not done',
    defer: 'Defer',
    deferring: 'Deferring…',
    pin: 'Lock',
    unpin: 'Unlock',
    // Every list has several "Done" buttons, so the accessible name says which task.
    completeLabel: (title: string) => `Done: ${isolate(title)}`,
    uncompleteLabel: (title: string) => `Mark as not done: ${isolate(title)}`,
    deferLabel: (title: string) => `Defer: ${isolate(title)}`,
    pinLabel: (title: string) => `Lock: ${isolate(title)}`,
    unpinLabel: (title: string) => `Unlock: ${isolate(title)}`,
    actionsLabel: (title: string) => `Actions: ${isolate(title)}`,
    completed: 'Marked as done',
    uncompleted: 'Marked as not done',
    // S18: what the "done" toast adds from S19's progress, joined to the text above with ". ".
    xpGained: (xp: number) => `+${String(xp)} XP`,
    xpLost: (xp: number) => `−${String(xp)} XP`,
    levelUp: (level: number) => `You reached level ${String(level)}`,
    badgeEarned: (names: string) => `New badge: ${names}`,
    pinnedDone: 'Locked in place',
    unpinnedDone: 'Unlocked',
    deferred: (day: string, time: string) => `I moved it to ${inSentence(day)} at ${time}.`,
    deferredSomewhere: 'I deferred the task.',
    deferUndone: 'Deferral undone',
    today: 'Today',
    tomorrow: 'Tomorrow',
    yesterday: 'Yesterday',
    // durationText (time.ts): minutes under an hour, whole and half hours, else hours and minutes.
    minute: '1 min',
    minutes: (n: number) => `${String(n)} min`,
    hour: '1 hour',
    hourAndHalf: '1.5 hours',
    twoHours: '2 hours',
    hours: (n: number) => plural(n, 'hour', 'hours'),
    hoursAndMinutes: (hours: string, minutes: number) => `${hours} ${String(minutes)} min`,
    report: {
      title: 'What didn’t fit',
      loading: 'Checking why…',
      failed: 'I couldn’t check why these tasks didn’t fit.',
      tasks: 'Tasks that didn’t fit',
      task: (title: string, duration: string) => `${isolate(title)} (${duration})`,
      // After the task, when the preview said why: "Chapter 3 (1.5 hours): There isn't enough time before the exam."
      reason: (reason: string) => `: ${reason}`,
      raise: (duration: string) => `Raise to ${duration} a day`,
      raised: (duration: string) => `Your daily study time is now ${duration}. You can ask me to replan your calendar.`,
    },
  },
  // S14
  today: {
    title: 'Today',
    progressLabel: 'Today’s progress',
    progress: (done: number, total: number) => `${String(done)} of ${plural(total, 'minute', 'minutes')}`,
    next: 'Up next',
    // The next block when it is on a later day: "Tomorrow, 09:00".
    nextAt: (day: string, time: string) => `${day}, ${time}`,
    blocks: 'Today’s blocks',
    // Today's list when the next block (today's) has its own card above it.
    moreBlocks: 'Later today',
    // A line above the next block when it is on a later day.
    noBlocksToday: 'No blocks today.',
    // The empty screen: a title, one line, and a link to the exams screen (S27 decision 11).
    noTasks: 'Your calendar is empty',
    noTasksHint: 'I build it from your exams and their materials.',
    toExams: 'Go to exams',
    // Nothing is planned from now on: the title of an empty state with no action.
    noMoreTasks: 'Nothing else is planned',
    noMoreTasksHint: 'There are no blocks planned for the coming week.',
    planFailed: 'I couldn’t check the coming days.',
    stale: 'I couldn’t refresh, so your calendar may be out of date.',
  },
  // S18: the morning review card (web/src/today/ReviewCard.tsx).
  review: {
    title: 'Morning review',
    lead: (count: number) =>
      count === 1
        ? '1 block went by without a mark. What happened with it?'
        : `${String(count)} blocks went by without a mark. What happened with them?`,
    // After the last block was handled, until the screen is left: the heading keeps the focus.
    allDone: 'That’s every past block sorted.',
    // "Yesterday, 14:00–15:00".
    when: (day: string) => `${day}, `,
    // After the time range, on the same line: ". Probability" or ". Probability. Part 1 of 2".
    details: (exam: string, part: string | null) => `. ${isolate(exam)}${part === null ? '' : `. ${part}`}`,
    complete: 'Done',
    moveToday: 'Move to today',
    moving: 'Moving…',
    skip: 'Skip',
    // Every row has the same three buttons, so the accessible name says which block (and which part).
    completeLabel: (name: string) => `Done: ${isolate(name)}`,
    moveTodayLabel: (name: string) => `Move to today: ${isolate(name)}`,
    skipLabel: (name: string) => `Skip: ${isolate(name)}`,
    moved: (day: string, time: string) => `I moved it to ${inSentence(day)} at ${time}.`,
    movedSomewhere: 'I moved the task.',
    moveUndone: 'Move undone',
    // The action of the no_time_today toast: POST reschedule {today_only: false}.
    moveNext: 'Next free spot',
    skipped: (title: string) => `Skipped ${isolate(title)}`,
    skipUndone: 'Skip undone',
  },
  // S18: moving a block within its day: drag, keyboard and the "move" dialog.
  move: {
    // The action on a block (its menu), next to "Defer" and "Lock".
    move: 'Move',
    moveLabel: (name: string) => `Move: ${isolate(name)}`,
    moved: (time: string) => `I moved it to ${time} and locked it.`,
    undone: 'Move undone',
    // MoveDialog: the times on the 15-minute grid the block can move to (GET /blocks/{id}/slots).
    dialogTitle: (name: string) => `Move ${isolate(name)}`,
    dialogLead: 'Pick a free time on the same day. I’ll lock the block at its new time.',
    // Before the block's current time range.
    current: 'Current time: ',
    slotsLabel: 'Free times',
    loading: 'Looking for free times…',
    loadFailed: 'I couldn’t load the free times.',
    empty: 'There’s no other free time that day.',
    confirm: 'Move',
    // The view switch above today's blocks.
    viewLabel: 'Blocks view',
    list: 'List',
    timeline: 'Timeline',
    // DayTimeline: the day from waking to sleep; an upcoming block has a drag handle.
    timelineLabel: 'Today’s timeline',
    handleLabel: (name: string) => `Move ${isolate(name)}`,
    instructions:
      'Drag the handle up or down. With a keyboard: Enter or Space starts a move, the up and down arrows move by 15 minutes, Page Up and Page Down move by an hour, Enter confirms and Escape cancels.',
    // The live region while moving: "14:30–15:30, free".
    candidate: (range: string, free: boolean): string => `${range}, ${free ? 'free' : 'taken'}`,
    // The parts alone, for the ghost on the timeline, which draws the range itself.
    candidateJoiner: ', ',
    candidateState: (free: boolean) => (free ? 'free' : 'taken'),
    // Between the details of a block on the timeline: "14:00–15:00. Now. Locked".
    detailsJoiner: '. ',
    cancelled: 'Move cancelled. The block stays where it was.',
    // The live region after a release on a time the block cannot take (the toast says why).
    refused: 'The block went back to its place.',
  },
  // S14: the week screen (web/src/week).
  week: {
    title: 'Week',
    range: (first: string, last: string) => `${first} to ${last}`,
    moves: 'Move between weeks',
    previous: 'Previous week',
    thisWeek: 'This week',
    next: 'Next week',
    free: 'Free day',
    empty: 'No blocks this week',
    total: (duration: string) => `${duration} in total`,
    stale: 'I couldn’t refresh your calendar, so it may be out of date. I’ll try again in a minute.',
  },
  // S15: the exams list and the exam screen (Task 6); analysis and materials (Task 7).
  exam: {
    // The h1 of the exam screen until the exam itself is known (loading, failed, not found).
    title: 'Exam',
    // The exams list (/exams).
    list: {
      title: 'Exams',
      listTitle: 'Your exams',
      count: (count: number) => plural(count, 'exam', 'exams'),
      empty: 'No exams yet',
      emptyHint: 'Add your nearest exam, and I’ll build a plan for it.',
      newExam: 'New exam',
      formTitle: 'New exam',
      create: 'Add exam',
    },
    // 0 = today, 1 = tomorrow; a negative count is an exam that already took place.
    inDays: (days: number) => {
      if (days < 0) return 'already passed'
      if (days === 0) return 'today'
      if (days === 1) return 'tomorrow'
      return `in ${String(days)} days`
    },
    notFound: 'I couldn’t find this exam',
    notFoundHint: 'It may have been deleted.',
    backToList: 'All exams',
    header: {
      edit: 'Edit',
      editLabel: 'Edit exam details',
      // The name of the button starts with its visible text ("Edit"), so voice control finds it.
      editNamed: 'Edit: exam details',
      // "23 November 2026, in 6 days. Difficulty: hard": the parts around the days left, which are emphasised.
      dateThen: (date: string) => `${date}, `,
      thenDifficulty: (difficulty: string) => `. ${difficulty}`,
      saved: 'Exam details saved',
      replanReason: 'The exam details changed, so it’s worth replanning your calendar.',
    },
    timeline: {
      title: 'Until the exam',
      listLabel: 'The days until the exam',
      // "Tue, 17 Nov": the short weekday, then dayMonth. Used in the aria-label of a timeline column; the visible column shows the two as separate lines.
      day: (weekday: string, dayMonth: string) => `${weekday}, ${dayMonth}`,
      planned: (minutes: number) => (minutes === 0 ? 'No study planned' : `${plural(minutes, 'minute', 'minutes')} planned`),
      done: (minutes: number) => `${plural(minutes, 'minute', 'minutes')} done`,
      today: 'Today',
      restDay: 'Rest day',
      examDay: 'Exam day',
      legendPlanned: 'Planned',
      legendDone: 'Done',
      legendRest: 'Rest',
      legendExam: 'Exam',
      farNote: 'The exam is far off: the timeline shows the next 62 days.',
      noDays: 'The exam has passed, so there are no days to show.',
    },
    topics: {
      title: 'Topics and tasks',
      empty: 'No tasks for this exam yet',
      emptyHint: 'You can add a task, or let me build a plan from your materials.',
      noTopic: 'No topic',
      weight: (weight: number) => `Importance ${String(weight)} of 5`,
      weightLabel: 'Topic importance',
      evidence: 'What is this based on?',
      editNamed: (name: string) => `Edit: ${isolate(name)}`,
      name: 'Topic name',
      nameRequired: 'Give the topic a name.',
      saved: 'Topic saved',
      gapsTitle: 'Topics with no material',
      },
    tasks: {
      kinds: {
        learn: 'Learning',
        practice: 'Practice',
        review: 'Review',
        simulation: 'Simulation',
        simulation_review: 'Simulation review',
        custom: 'Task',
      },
      // The badge of a skipped task. A done task is the filled check and the struck-through title.
      skipped: 'Skipped',
      minutes: (minutes: number) => `${String(minutes)} min`,
      focus: (focus: number) => `Focus ${String(focus)}/10`,
      next: (when: string) => `On the calendar: ${when}`,
      notOnBoard: 'Not on the calendar yet',
      // The subtitle of a row: "Learning, 60 min. Focus 3/10".
      details: (kind: string, minutes: string, focus: string) => `${kind}, ${minutes}. ${focus}`,
      reason: 'Why this task?',
      hideReason: 'Hide the reason',
      skip: 'Skip',
      backToTodo: 'Undo skip',
      edit: 'Edit',
      delete: 'Delete',
      // The two controls of a row name the task, so a screen reader user knows which row they act
      // on: the check button (pressed = done) and the menu with the rest of the actions.
      markDoneNamed: (title: string) => `Done: ${isolate(title)}`,
      actionsNamed: (title: string) => `Actions: ${isolate(title)}`,
      formLabel: (title: string) => `Edit the task ${isolate(title)}`,
      title: 'Task name',
      titleRequired: 'Give the task a name.',
      minutesLabel: 'Length in minutes',
      minutesRange: 'Between 5 and 600 minutes.',
      kind: 'Type',
      focusLabel: 'Focus needed (1–10)',
      focusRange: 'Between 1 and 10.',
      topic: 'Topic',
      saved: 'Saved',
      placed: 'Saved. I placed the task on your calendar again.',
      notPlaced: (reason: string) => `Saved, but the task didn’t fit on your calendar: ${reason}`,
      notPlacedNoReason: 'Saved, but the task didn’t fit on your calendar.',
      deleted: 'Task deleted',
      restored: 'Task restored',
      undone: 'Change undone',
      add: 'Add task',
      addTitle: 'New task',
      added: 'Task added',
      addedPlaced: 'Task added and placed on your calendar',
    },
    // The analysis part of the exam screen (Task 7): build the plan, reanalyze, the draft's preview.
    analysis: {
      title: 'Materials analysis',
      buildTitle: 'A plan for this exam',
      buildIntro: 'This exam has no tasks from your materials yet. I’ll build them from the files you uploaded and place them on your calendar.',
      build: 'Build a plan for this exam',
      reanalyze: 'Analyse again',
      reanalyzeIntro:
        'I’ll build new tasks from your materials in place of the ones you haven’t started. Whatever you finished, started or added yourself stays. You’ll see what changes before you confirm. Up to 3 analyses a day.',
      starting: 'Getting started…',
      // The summary at the end of the section's heading row, while something in it needs attention.
      summaryRunning: 'Running now',
      summaryFailed: 'Didn’t work',
      summaryDraft: 'Waiting for you',
      failedTitle: 'The analysis didn’t work',
      built: 'Your plan for this exam is ready, and I placed its tasks on your calendar.',
      draftWaiting: 'A new analysis is waiting for you',
      draftHint: 'You can see what changes before you confirm.',
      showDraft: 'Show the change',
      draftGone: 'This analysis is no longer current: it was confirmed, replaced by a newer one or cancelled.',
      replanReason: 'This exam already has tasks. I can place them on your calendar again.',
      replan: 'Replan your calendar',
      // The preview dialog.
      previewTitle: 'The new analysis',
      previewLoading: 'Working out what would change…',
      replaced: (count: number) => (count === 1 ? '1 task will be replaced' : `${String(count)} tasks will be replaced`),
      kept: (count: number) =>
        count === 0 ? 'No current task stays' : count === 1 ? '1 task stays as it is' : `${String(count)} tasks stay as they are`,
      added: (count: number) => plural(count, 'new task', 'new tasks'),
      addedListLabel: 'New tasks',
      replacedListLabel: 'Tasks that will be replaced',
      taskMeta: (kind: string, minutes: string) => `${kind}, ${minutes}`,
      boardTitle: 'On the calendar',
      noBoardChange: 'The blocks on your calendar don’t change.',
      applied: 'The new analysis is in your plan.',
      undone: 'I went back to your previous plan.',
    },
    // The materials part of the exam screen (Task 7): the S13 list and upload, and the kind of each file.
    materials: {
      title: 'Materials',
      kindLabel: (name: string) => `File type: ${isolate(name)}`,
      kindSaved: 'File type saved',
      // S28: the summary of the collapsed section.
      count: (count: number) => (count === 0 ? 'No files' : plural(count, 'file', 'files')),
      reanalyzeHint: 'Your materials changed. If you analyse again, I’ll use them to build the tasks.',
    },
  },
  // S15: settings, export, account deletion and the goodbye page (Task 8).
  settings: {
    title: 'Settings',
    // A length of time: the start delay, the me time, and a daily study time that is not a whole hour.
    duration: (minutes: number) => {
      const named: Record<number, string> = { 60: '1 hour', 90: '1.5 hours', 120: '2 hours' }
      return named[minutes] ?? plural(minutes, 'minute', 'minutes')
    },
    preferences: {
      title: 'Study preferences',
      intro: 'I schedule your study by these preferences. After you save, I’ll offer to update your plan.',
      // The four groups of the form, each an h3.
      groups: {
        amount: 'How much and when',
        routine: 'Daily routine',
        hobby: 'Me time',
        rest: 'Before an exam',
      },
      hoursQuestion: 'How many hours a day feels realistic for you?',
      windowsQuestion: 'When do you like to study?',
      windowsHint: 'You can pick more than one.',
      windowsRequired: 'Pick at least one time of day.',
      wakeTime: 'Wake-up time',
      sleepTime: 'Bedtime',
      sameTimes: 'Your bedtime needs to be different from your wake-up time.',
      afterMidnight: 'Your bedtime is earlier than your wake-up time, so it counts as after midnight.',
      nightShiftRest: 'When there are rest days before an exam, the last study day ends at your bedtime.',
      delayQuestion: 'How soon after waking up can you start studying?',
      delayNow: 'Right away',
      hobbyLabel: 'Me time every day',
      hobbyHint: 'A fixed time each day when I won’t schedule any study.',
      hobbyStart: 'When it starts',
      hobbyMinutes: 'How long',
      restQuestion: 'How many rest days before an exam?',
      restDays: (days: number) => (days === 0 ? 'None' : dayCount(days)),
      save: 'Save',
      saved: 'Saved',
      replanReason: 'Your preferences changed. Should I update your plan to match?',
      invalidField: 'This value isn’t valid.',
    },
    export: {
      title: 'Export your data',
      description:
        'A JSON file with your profile, exams, tasks, calendar, topics, the details of your materials (not the files themselves), the analyses and the AI usage log.',
      button: 'Download the file',
    },
    danger: {
      title: 'Delete your account',
      description: 'Deletes your account and all your data. This can’t be undone.',
      link: 'Delete my account',
    },
    deleteAccount: {
      title: 'Delete your account',
      intro: 'Deletion is immediate and final. There’s no way to undo it and no grace period.',
      whatTitle: 'What gets deleted',
      what: [
        'Your profile and preferences',
        'Your exams, tasks and plan',
        'Your topics and analyses',
        'The files you uploaded',
        'The usage log',
        'Your sign-in account',
      ],
      exportFirst: 'Want to keep a copy? Download your data first.',
      exportLink: 'Export your data',
      confirmWord: 'delete',
      confirmLabel: 'To confirm, type the word “delete”',
      submit: 'Delete my account for good',
      back: 'Back to settings',
    },
    goodbye: {
      title: 'Your account is deleted',
      body: 'All your data has been deleted.',
      login: 'Back to sign-in',
    },
  },
  // S16: push reminders (web/src/notifications).
  notifications: {
    title: 'Reminders',
    intro: 'I’ll remind you before each study block, even when the app is closed.',
    deviceTitle: 'Reminders on this device',
    notConfigured: 'Reminders aren’t available on this site yet.',
    unsupported: 'This browser doesn’t support reminders. Try a recent version of Chrome, Edge, Firefox or Safari.',
    iosTitle: 'On iPhone and iPad, reminders work only when you open the app from your Home Screen.',
    iosSteps: [
      'In Safari, tap the Share button (a square with an arrow pointing up).',
      'Choose “Add to Home Screen”, then tap “Add”.',
      `Open the app from the ${PRODUCT_NAME} icon on your Home Screen.`,
      'Come back to this screen and turn reminders on.',
    ],
    blockedTitle: 'Notifications are blocked in this browser.',
    blockedBrowser: 'In the browser: click the lock or settings icon next to the address, allow “Notifications”, and reload the page.',
    blockedApp: `In the app installed on your phone: open your phone’s Settings, then ${PRODUCT_NAME}, then “Notifications”.`,
    checking: 'Checking your reminders…',
    off: 'Reminders are off on this device.',
    on: 'Reminders are on for this device.',
    enable: 'Turn on reminders',
    disable: 'Turn off',
    enabled: 'Reminders are on for this device.',
    disabled: 'Reminders are off on this device.',
    notAllowed: 'You didn’t allow notifications, so reminders stay off.',
    enableFailed: 'I couldn’t turn reminders on. Please try again.',
    disableFailed: 'I couldn’t turn reminders off. Please try again.',
    leadLabel: 'When to remind you',
    leadHint: 'Applies to every device where reminders are on.',
    lead0: 'When the block starts',
    lead5: '5 minutes before',
    lead10: '10 minutes before',
    lead15: '15 minutes before',
    leadSaved: 'Reminder time saved',
    installTitle: 'Want a reminder before each block?',
    installText: 'On iPhone, reminders work only after you add the app to your Home Screen.',
    installHow: 'Show me how',
    installDismiss: 'Got it',
  },
  // S16: the service worker's texts live in enPwa.ts, so sw.js does not bundle this file.
  pwa: enPwa,
  // S19: the progress board (web/src/progress).
  progress: {
    title: 'Progress',
    // Numbers are formatted by the caller (progress/format.ts), so 10000 reads "10,000".
    level: {
      title: 'Level',
      level: (level: number) => `Level ${String(level)}`,
      totalXp: (xp: string) => `${xp} XP in total`,
      barLabel: (next: number) => `Progress to level ${String(next)}`,
      barValue: (done: string, total: string) => `${done} of ${total} XP`,
      max: 'This is the highest level.',
      blocksDone: (count: number) =>
        count === 0 ? 'No blocks done yet' : count === 1 ? '1 block done' : `${String(count)} blocks done`,
    },
    streak: {
      title: 'Study streak',
      current: 'Current streak',
      longest: 'Longest streak',
      days: dayCount,
      start: 'Today is a good day to start.',
      studiedToday: 'You studied today.',
      keepGoing: 'One block today keeps your streak going.',
    },
    days: {
      summary: (studied: number, total: number) =>
        studied === 0
          ? `No study days in the last ${String(total)} days yet.`
          : `${plural(studied, 'study day', 'study days')} in the last ${String(total)} days.`,
      // Sunday first, as Date.getUTCDay() counts.
      weekdayLetters: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
    },
    badges: {
      title: 'Badges',
      summary: (earned: number, total: number) => `${String(earned)} of ${String(total)} earned`,
      earnedOn: (date: string) => `Earned on ${date}`,
      // An earned badge whose date is missing.
      earned: 'Earned',
      notEarned: 'Not earned yet',
      // The line under the name of a badge: "A 7-day study streak. Earned on 13 November 2026".
      details: (parts: string[]) => parts.filter((part) => part !== '').join('. '),
      towards: (current: string, threshold: string) => `${current} of ${threshold}`,
      groups: {
        first: 'Getting started',
        blocks: 'Blocks done',
        streak: 'Study streak',
        level: 'Levels',
        xp: 'XP',
      },
      // By badge key (api/app/domain/gamification): a name and a short line on what earns it.
      items: {
        first_task: { name: 'First step', description: 'Your first block done' },
        task_master_10: { name: '10 blocks', description: '10 study blocks done' },
        task_master_20: { name: '20 blocks', description: '20 study blocks done' },
        task_master_50: { name: '50 blocks', description: '50 study blocks done' },
        task_master_100: { name: '100 blocks', description: '100 study blocks done' },
        iron_will_7: { name: 'A week straight', description: 'A 7-day study streak' },
        iron_will_10: { name: '10 days straight', description: 'A 10-day study streak' },
        iron_will_14: { name: 'Two weeks straight', description: 'A 14-day study streak' },
        iron_will_30: { name: '30 days straight', description: 'A 30-day study streak' },
        iron_will_100: { name: '100 days straight', description: 'A 100-day study streak' },
        knowledge_seeker_5: { name: 'Level 5', description: 'Level 5 reached' },
        knowledge_seeker_10: { name: 'Level 10', description: 'Level 10 reached' },
        knowledge_seeker_20: { name: 'Level 20', description: 'Level 20 reached' },
        knowledge_seeker_25: { name: 'Level 25', description: 'Level 25 reached' },
        knowledge_seeker_50: { name: 'Level 50', description: 'The highest level reached' },
        xp_1000: { name: '1,000 XP', description: '1,000 XP in total' },
        xp_5000: { name: '5,000 XP', description: '5,000 XP in total' },
        xp_10000: { name: '10,000 XP', description: '10,000 XP in total' },
      },
      // A key the web does not know yet (a newer API): shown by its threshold.
      unknown: { name: 'Badge', description: '' },
    },
  },
  // S31: Archi, the cut-paper character. The accessible name of each mood's illustration: a
  // description of the picture, so here (and only here) the name is the subject.
  archie: {
    alt: {
      intentions: 'Archi watering a pot with books sprouting from it',
      eureka: 'Archi meditating, with a golden stone',
      wisdom: 'Archi writing calligraphy on a scroll',
      flow: 'Archi raking spirals in the sand of a zen garden',
      rest: 'Archi at a tea ceremony',
      joy: 'Archi smiling, with a golden stone in hand',
    },
  },
} as const
