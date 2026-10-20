# Phase 19: Gamification (XP, Login Streaks, Morning Prompt) - Context

**Gathered:** 2026-03-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement a quiet, minimalist gamification system that motivates daily engagement without disrupting StudyFlow's zen mentor aesthetic. The system includes:
- **Achievements Tab** within Profile showing XP progression, badges, and streaks
- **Login Streak Tracking** with visual feedback for consecutive days and gentle disappointment on breaks
- **Morning Prompt** algorithm to reschedule unfinished tasks from the previous day
- **Minimal Feedback System** for task completion and milestone moments

All gamification elements are optional for user motivation—never punitive or guilt-inducing.

</domain>

<decisions>
## Implementation Decisions

### Achievements Tab Placement & Content
- Located within **Profile tab** as a scrollable panel (not a separate navigation tab)
- Displays single stat: **Current Streak** (e.g., "7 days")
- Shows **achievement badges** organized by unlock date (newest first)
- Locked badges are **hidden until unlocked** — don't show "locked" state
- Badges earned at **unlock moment** use **minimal celebration** (Claude's discretion on timing/fanfare)

### XP Progression & Levels
- **XP earned** based on task **focus_score** (difficulty rating) — harder tasks grant more XP
- **Level system** (e.g., Level 1-50) where each level requires fixed XP cost to reach
- **Two separate progress circles** (not nested):
  - Inner circle: daily XP progress (resets at midnight, user's timezone)
  - Outer circle: overall XP progress across entire exam period
- Circles display **minimal labels only** ("Daily", "Overall") — no numbers
- Circles **medium-sized** (~80-100px diameter), placed **below achievement badges**
- Color transitions: **You decide** (Claude uses subtle, calm palette matching zen aesthetic)

### Achievement Badges
- **Mixed criteria** for unlocks: combination of login streaks, task volume, and special milestones
- Examples: "Iron Will: 7-day streak", "Knowledge Seeker: 50 tasks completed", etc.
- Badge organization if many exist: **You decide** (Claude keeps it simple; organize as content grows)

### Login Streak Tracking
- **Splash screen on first login** only when streak ≥ 3 days
  - **3+ day streak**: Encouraging tone ("You're on a 7-day streak! Keep it going.")
  - **Milestone streaks** (7, 14, 30, etc.): Special celebratory splash screens
  - **Auto-dismiss** after 3-5 seconds; user returns to daily view
- **Streak break detection**: You decide (background check vs login-based detection)
- **Broken streak presentation**: Simple counter reset to 0, with **gentle disappointment icon** in Achievements Tab
- **Counter display**: Simple number format (e.g., "7 days")

### Morning Prompt (Rescheduling Algorithm)
- **Trigger**: First login of the day only
- **Display**: Modal listing all unfinished tasks from yesterday
- **User options per task**: **"Reschedule today"** only (no delete, snooze, or other actions)
- **Rescheduling logic**:
  - **Automatic placement** into available time slots respecting:
    - Sleep hours
    - Study hour quota
    - Break/hobby time
  - **Priority**: Place by **task focus_score** (harder tasks placed first/earlier)
  - **If task doesn't fit**: Ask user to choose: reschedule, delete, or skip
- **After rescheduling**: Modal closes; return to **daily view** showing updated schedule
- **Feedback**: No intermediate success message — schedule speaks for itself

### Claude's Discretion
- Color gradients and exact shade choices for progress circles
- Exact splash screen animation/transition timings
- Whether to show level-up notifications (keep minimal)
- How to visually distinguish milestone splashes (7, 14, 30-day streaks)
- Specific badge icon designs and visual styles

</decisions>

<specifics>
## Specific Ideas

- **Zen aesthetic**: All gamification elements feel like supporting infrastructure, not the main show — the schedule is the hero
- **Positive reinforcement only**: Achievements motivate through progress, not punishment
- **No guilt mechanics**: Breaking a streak or missing tasks doesn't trigger shame; gentle acknowledgment only
- **Linear progress feeling**: Circular progress bars and level systems should feel like a natural continuation, not arbitrary grinding

</specifics>

<deferred>
## Deferred Ideas

- **Leaderboards or social sharing** — future phase (social features)
- **Custom badges or achievement creation** — future phase (gamification v2)
- **Streaks for study hours** (not just login) — phase extensions
- **Notification fanfare on big milestones** — evaluate after launch
- **Achievement categories with filtering** — if badge count grows large

</deferred>

---

*Phase: 19-gamification-xp-login-streaks*
*Context gathered: 2026-03-03*
