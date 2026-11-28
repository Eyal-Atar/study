// Without a network (S38): the app shows the last calendar it read, read only. One notice says what is
// shown, as of when, and when actions come back; the rest are what a screen says in place of something
// it cannot do or does not have. The save that failed has its own sentence, en.errors.offline.
export const enOffline = {
  // The notice above a screen (OfflineNotice). `when` is a time today ('11:20'), or a day and a time
  // ('Sun, 22 Nov, 09:00').
  notice: (when: string) => `You’re offline. I’m showing your calendar as of ${when}. You can act again once the connection is back.`,
  // The same notice when nothing of the calendar was saved, so there is no time to give.
  noticeNoTime: 'You’re offline. You can act again once the connection is back.',
  // What a screen reader hears, once, when the app goes offline (OfflineAnnouncer).
  announce: 'You’re offline. Your calendar is read only until the connection is back.',
  // In a block's sheet, in place of its actions.
  blockOnly: 'You’re offline, so I can only show this block for now.',
  // In place of a screen's content that was never saved on this device (LoadingState).
  notSaved: 'I don’t have this saved on your device. I’ll load it once the connection is back.',
  // On the focus screen, when Done cannot reach the server.
  focusDone: 'You’re offline, so I can’t mark this Done yet. Your session stays here until the connection is back.',
} as const
