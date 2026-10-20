# Pitfalls Research

**Domain:** AI-Powered Study Planner (FastAPI + SQLite + Vanilla JS)
**Researched:** 2026-02-17
**Confidence:** HIGH

## Critical Pitfalls

### Pitfall 1: localStorage Token Storage Vulnerability

**What goes wrong:**
Storing authentication tokens in localStorage exposes the application to XSS attacks. If an attacker injects malicious JavaScript, they can exfiltrate tokens and gain full account access. Current implementation stores tokens in localStorage (`localStorage.setItem('studyflow_token', authToken)`).

**Why it happens:**
localStorage is accessible to any JavaScript code running on the page, including injected malicious scripts. Many developers choose localStorage because it's simple to implement and persists across browser sessions.

**How to avoid:**
- Migrate tokens from localStorage to HttpOnly cookies immediately
- Set cookies with `HttpOnly`, `Secure`, and `SameSite=Strict` flags
- Store short-lived access tokens in memory (React state/context if migrating to framework)
- Store refresh tokens in HttpOnly cookies only
- Update all API endpoints to read tokens from cookies instead of Authorization headers

**Warning signs:**
- Seeing `localStorage.getItem('studyflow_token')` in frontend code
- No cookie configuration in FastAPI response
- Missing CSRF protection mechanisms
- Authorization headers sent from client-side JavaScript

**Phase to address:**
Phase 1: Google OAuth Implementation - OAuth flow must use secure token storage from day one, not localStorage

---

### Pitfall 2: SQLite Multi-Instance Write Concurrency

**What goes wrong:**
SQLite cannot handle writes from multiple application instances simultaneously. When deploying to platforms like Fly.io, Railway, or Render that default to multiple instances, the second instance will get database locked errors or corrupt data.

**Why it happens:**
SQLite is designed for single-writer access. Cloud platforms auto-scale to multiple instances for reliability, but current database.py uses basic `sqlite3.connect()` without WAL mode or proper locking.

**How to avoid:**
- Enable Write-Ahead Logging (WAL): `conn.execute("PRAGMA journal_mode=WAL")`
- Configure deployment to run single instance: `scale = 1` in fly.toml or equivalent
- Add connection pool with proper timeout: `conn.execute("PRAGMA busy_timeout = 5000")`
- Consider migration path to PostgreSQL for production (note in deployment phase)
- Add database health check endpoint that tests write capability

**Warning signs:**
- "database is locked" errors in logs
- Intermittent 500 errors during concurrent requests
- Data not persisting consistently
- Platform dashboard shows multiple instances running

**Phase to address:**
Phase 6: Deployment Configuration - Must configure WAL mode and single-instance deployment before going live

---

### Pitfall 3: Google OAuth State Parameter CSRF Vulnerability

**What goes wrong:**
Omitting or improperly validating the OAuth `state` parameter allows CSRF attacks where attackers can trick users into linking the attacker's Google account to the victim's app account.

**Why it happens:**
The state parameter validation is commonly skipped because the OAuth flow appears to work without it. Developers focus on getting the token exchange working and miss this critical security step.

**How to avoid:**
- Generate cryptographically secure random state: `secrets.token_urlsafe(32)`
- Store state in secure session (Redis or signed cookie)
- Validate state matches on callback before exchanging authorization code
- Set state expiration (5 minutes max)
- Use battle-tested library: `authlib` or `fastapi-users` OAuth provider

**Warning signs:**
- No state parameter in OAuth authorization URL
- State stored in localStorage or URL parameters
- Missing state validation in callback endpoint
- Using predictable state values (timestamps, user IDs)

**Phase to address:**
Phase 1: Google OAuth Integration - State validation must be implemented in initial OAuth endpoint creation

---

### Pitfall 4: Drag & Drop Event.preventDefault() Omission

**What goes wrong:**
Drag and drop fails silently because browser default behavior prevents drops. The dragover and dragenter events must call `event.preventDefault()`, but this is non-obvious and easy to forget, resulting in hours of debugging why drops don't work.

**Why it happens:**
HTML5 drag and drop API design requires explicit opt-in to drop zones. Without preventDefault(), the browser's default "no dropping" behavior takes precedence.

**How to avoid:**
- Always call `event.preventDefault()` in dragover handler
- Always call `event.preventDefault()` in dragenter handler
- Add visual feedback in dragover (add class like "drag-over")
- Remove feedback in dragleave (remove class)
- Set `draggable="true"` attribute on source elements
- Use `dataTransfer.setData()` in dragstart to store task ID

**Warning signs:**
- Drop event never fires
- Elements appear draggable but won't drop
- Console shows no errors but functionality broken
- Cursor shows "not allowed" symbol over drop zone

**Phase to address:**
Phase 2: Calendar Drag & Drop - Must be in base drag & drop implementation, not discovered during testing

---

### Pitfall 5: PWA Notification Permission Prompt Timing

**What goes wrong:**
Requesting notification permissions immediately on app load results in 90%+ rejection rates. Users dismiss prompts they don't understand, and browsers penalize sites that spam permission requests. Once rejected, re-enabling is buried deep in browser settings.

**Why it happens:**
Developers treat notification permission like other feature flags - check and request at startup. This ignores the psychology of user trust and value demonstration.

**How to avoid:**
- Never request permission on initial load
- Wait until user completes first study session successfully
- Show contextual explanation: "Get notified 5 min before your study session"
- Provide clear "Enable Notifications" button user clicks intentionally
- Track permission state and don't re-prompt if denied
- Test permission request flow on both Chrome and Safari iOS (different behaviors)

**Warning signs:**
- `Notification.requestPermission()` called in init function
- No explanation modal before permission prompt
- Permission requested before user sees app value
- No handling of "denied" state (repeated prompts)

**Phase to address:**
Phase 4: Notifications - User onboarding flow must be designed before notification code

---

### Pitfall 6: Service Worker Registration Scope Confusion

**What goes wrong:**
Service worker registered at wrong path (e.g., `/js/sw.js`) has limited scope and can't intercept network requests for the whole app. Notification and offline features fail mysteriously for paths outside the service worker's scope.

**Why it happens:**
Developers place service worker in existing JS directory thinking organization matters more than browser scope rules. Service worker scope is determined by its location, not registration options.

**How to avoid:**
- Always place service worker at root: `/sw.js`
- Register with `navigator.serviceWorker.register('/sw.js')`
- Never place in subdirectories like `/js/` or `/scripts/`
- Verify scope in DevTools: Application > Service Workers
- Test offline behavior on multiple routes, not just homepage
- Add `Service-Worker-Allowed` header only if root placement impossible

**Warning signs:**
- Service worker only works on homepage
- Notifications work but offline doesn't
- Scope in DevTools shows `/js/` instead of `/`
- Fetch event handlers not triggered for all pages

**Phase to address:**
Phase 5: PWA Configuration - File structure must be correct before any service worker code written

---

### Pitfall 7: Monolithic app.js Feature Collision

**What goes wrong:**
Adding hourly drag & drop, OAuth callbacks, notifications, and regenerate features to a single 4000+ line app.js creates function name collisions, impossible debugging, and race conditions. Variable scope leaks cause subtle bugs where one feature's state overwrites another's.

**Why it happens:**
The code started simple and grew organically. Each feature seemed "just one more function" until the file became unmaintainable. Refactoring feels risky with no tests.

**How to avoid:**
- Extract modules BEFORE adding new features: auth.js, calendar.js, notifications.js
- Use ES6 modules with explicit exports: `export { handleDrag, handleDrop }`
- Create state container for each feature (avoid global variables)
- Use module pattern or closures to encapsulate: `const AuthModule = (() => { ... })()`
- Write smoke tests before refactoring: critical paths still work
- Refactor incrementally: one module per phase

**Warning signs:**
- File exceeds 1000 lines
- Multiple features using same variable names (e.g., `currentId`)
- Difficulty finding where state is modified
- Functions depend on global initialization order
- Adding feature requires reading entire file

**Phase to address:**
Phase 0: Technical Debt (Pre-work) - Refactor app.js into modules before Phase 1 starts

---

### Pitfall 8: OAuth Redirect URI Mismatch

**What goes wrong:**
Google OAuth fails with "redirect_uri_mismatch" error because registered URI differs from callback by trailing slash, http vs https, or wrong port. Development works but production breaks because URLs differ.

**Why it happens:**
OAuth providers require exact character-by-character match including protocol, domain, path, and trailing slash. Developers test locally (http://localhost:8000/auth/callback) but deploy to HTTPS with different URL structure.

**How to avoid:**
- Register ALL redirect URIs: development, staging, production
- Use environment variables: `OAUTH_REDIRECT_URI=https://studyflow.app/auth/google/callback`
- Include trailing slash consistently (or omit consistently)
- Test OAuth flow in production-like environment before deployment
- Document all registered URIs in README
- Check Google Cloud Console > APIs & Services > Credentials > Authorized redirect URIs

**Warning signs:**
- OAuth works locally but fails in deployment
- Error message mentions "redirect_uri_mismatch"
- URLs differ by trailing slash between environments
- Hardcoded localhost URLs in production code

**Phase to address:**
Phase 1: Google OAuth - Environment config must be part of OAuth implementation, not deployment debugging

---

### Pitfall 9: Hourly Schedule Time Zone Naive Storage

**What goes wrong:**
Storing schedule blocks as naive time strings ("14:00") breaks when users travel or daylight saving time changes. Appointments appear at wrong times or disappear. Comparing times across dates becomes impossible.

**Why it happens:**
SQLite stores TEXT timestamps without timezone info. Python's datetime defaults to naive. Seems to work initially because dev and users are in same timezone.

**How to avoid:**
- Store all times in UTC ISO 8601 format: "2026-02-17T14:00:00Z"
- Convert to user's timezone only for display
- Use `datetime.utcnow()` not `datetime.now()`
- Store user timezone preference in user table
- Parse with timezone: `datetime.fromisoformat(dt_string).replace(tzinfo=timezone.utc)`
- Frontend: Use `Intl.DateTimeFormat` with timeZone option

**Warning signs:**
- Times stored as "HH:MM" strings without date
- No timezone field in users table
- Direct string comparison of times
- `datetime.now()` used instead of `datetime.utcnow()`
- No timezone conversion in API responses

**Phase to address:**
Phase 2: Hourly Scheduling - Database schema must include proper datetime format from start

---

### Pitfall 10: Exclusive Zone Strategy Algorithm Not Tested

**What goes wrong:**
The exclusive zone scheduler looks correct but produces invalid schedules: overlapping blocks, study sessions during sleep hours, or infinite loops when no valid schedule exists. Discovered only when user generates first roadmap with tight deadlines.

**Why it happens:**
Scheduling algorithms have many edge cases: no available time slots, tasks exceed available hours, time zone boundaries, holidays. Without formal testing, bugs surface in production with real user data.

**How to avoid:**
- Write test cases BEFORE implementing algorithm:
  - User with only 2 hours free per day
  - Exam deadline tomorrow with 8 hours of content
  - Sleep time crosses midnight (23:00 - 07:00)
  - No available time slots (entire day blocked)
  - Multiple exams on same day
- Implement fallback: "Cannot schedule, reduce tasks or extend deadline"
- Validate constraints in code: start < end, start >= wake_up, end <= sleep_time
- Add logging for algorithm decisions (why slot was chosen/rejected)
- Test with real-world scenario data, not toy examples

**Warning signs:**
- Algorithm implementation longer than 100 lines without tests
- No error handling for "impossible to schedule" case
- Datetime math using string manipulation
- Missing validation of output (overlaps, out of bounds)
- Algorithm works in demo but users report broken schedules

**Phase to address:**
Phase 3: Exclusive Zone Regenerate - Test cases must be written during algorithm design, not after bugs reported

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skip OAuth state validation | OAuth works faster in demo | CSRF vulnerability, security audit failure | Never - security issue |
| Keep tokens in localStorage | Simple implementation, works quickly | XSS vulnerability, failed security review | Never - security issue |
| Skip ES6 module refactoring | Add features to existing file | Impossible to maintain, bugs multiply | Never - debt compounds rapidly |
| Use SQLite without WAL | Simple database setup | Production crashes, data corruption | Acceptable for MVP if noted for migration |
| Skip service worker testing | PWA installs successfully | Offline mode breaks, updates fail | Never - PWA core functionality |
| Hardcode redirect URIs | Deploy faster, fewer env vars | Breaks in new environments, OAuth fails | Never - breaks deployment |
| Store naive datetimes | Simpler database schema | Timezone bugs, wrong appointment times | Never - data integrity issue |
| No drag & drop visual feedback | Feature works functionally | Poor UX, users confused | Acceptable for initial prototype, fix before launch |
| Request notifications on load | Faster feature demo | 90% rejection rate, users annoyed | Never - damages user trust permanently |
| No notification cleanup | Faster implementation | Database fills with dead subscriptions | Acceptable initially if cleanup planned for Phase 5 |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Google OAuth | Not registering all redirect URIs for dev/staging/prod | Add all environment URLs to Google Cloud Console before testing |
| FastAPI + SQLite | Not enabling WAL mode or checking same thread | Enable WAL with `PRAGMA journal_mode=WAL` and `check_same_thread=False` |
| Service Worker | Placing in `/js/sw.js` instead of `/sw.js` | Always place service worker at root path for correct scope |
| PWA Notifications | Not handling Safari iOS separately | Feature detect and provide fallback (Safari didn't support until recently) |
| Drag & Drop API | Forgetting dataTransfer.setData() in dragstart | Always set data in dragstart, read in drop handler |
| OAuth Token Storage | Sending tokens in Authorization headers from frontend | Let browser handle cookies automatically, no JS access |
| Hourly Scheduling | Using `datetime.now()` without timezone | Use `datetime.utcnow()` and store UTC, convert on display |
| Calendar Conflicts | Client-side only validation | Always validate on server - client can be bypassed |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| N+1 queries loading schedule | Dashboard slow to load (>2s) | Use JOIN to fetch tasks + schedule_blocks together | 50+ scheduled tasks |
| No index on schedule_blocks.day_date | Calendar month view slow | Already exists: `idx_schedule_day` - verify used | 500+ schedule blocks |
| Loading entire task list on drag | Drag operation lags or freezes | Only query tasks for visible date range | 100+ tasks |
| Service worker caching API responses | Stale data shown after updates | Cache static assets only, not API responses. Or use cache-then-network strategy with timestamps | After first offline use |
| localStorage.getItem on every render | UI stutters during interactions | Cache auth token in memory, check localStorage once on load | Not a real issue unless called thousands of times |
| SQLite without connection pooling | Random "database locked" errors | Implement connection pool with busy_timeout 5000ms | 10+ concurrent users |
| Notification subscription without cleanup | Database bloat, slow queries | Validate endpoints monthly, remove expired subscriptions | 1000+ subscriptions |
| Regenerate roadmap without debouncing | Multiple API calls if user clicks quickly | Debounce regenerate button (disable for 2s after click) | User impatience |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Tokens in localStorage | XSS can steal tokens, full account compromise | Use HttpOnly cookies with Secure and SameSite flags |
| No OAuth state validation | CSRF account linking attack | Generate secure random state, validate on callback |
| No rate limiting on auth endpoints | Brute force password attacks | Add rate limiting: 5 attempts per 15 min per IP |
| CORS set to allow all origins | Any website can make authenticated requests | Set specific origins: `allow_origins=["https://studyflow.app"]` |
| No input validation on schedule times | SQL injection or data corruption | Validate datetime format, check bounds (wake <= time <= sleep) |
| Notification endpoints without auth | Anyone can send notifications to your users | Require valid auth token for all notification operations |
| Exposing user email in API responses | Privacy leak, email harvesting | Only return email to account owner, use user ID for others |
| No HTTPS enforcement | Man-in-the-middle attacks, token theft | Redirect HTTP to HTTPS, set Secure flag on cookies |
| No CSRF protection on form submissions | Cross-site request forgery attacks | Use SameSite=Strict cookies, or CSRF tokens for state-changing operations |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No loading state during OAuth redirect | User clicks "Sign in with Google" and nothing happens for 2-3s | Show loading spinner immediately, disable button |
| Drag with no visual feedback | User doesn't know if drag started or where drop is allowed | Add "dragging" class, highlight valid drop zones |
| No explanation before notification permission | User denies permission, can't re-enable easily | Show modal explaining benefit: "We'll remind you 5 min before your study session" |
| Silent failure when schedule impossible | User clicks "Generate Roadmap", nothing happens | Show error: "Not enough time available. Reduce task hours or extend deadline." |
| Regenerate button with no confirmation | User accidentally clicks, loses custom changes | Show confirmation: "This will replace your current schedule. Continue?" |
| No offline feedback | User makes changes offline, doesn't know if saved | Show "Offline" banner, queue changes, sync when online |
| Time zones not displayed | User confused why appointment at wrong time | Show timezone: "2:00 PM PST" or "Study session starts in 2 hours" |
| Calendar shows past incomplete tasks | User sees overdue tasks, feels overwhelmed | Archive past incomplete tasks, show optional "catch up" section |

## "Looks Done But Isn't" Checklist

- [ ] **OAuth Login:** Token validation tested - verify expired tokens rejected, not just happy path
- [ ] **Drag & Drop:** Works on touch devices (mobile/tablet) - verify pointer events, not just mouse events
- [ ] **PWA Notifications:** Tested on Safari iOS, not just Chrome - verify platform differences handled
- [ ] **Service Worker:** Updates actually deploy - verify users get new version, not cached old code
- [ ] **Hourly Schedule:** Handles midnight crossover - verify 11:00 PM to 1:00 AM doesn't break
- [ ] **Timezone Logic:** Tested with user in different timezone from server - verify UTC conversion correct
- [ ] **Database Migrations:** Backward compatible - verify old data works, new columns have defaults
- [ ] **OAuth Redirect:** Works on deployed domain, not just localhost - verify all environments registered
- [ ] **Conflict Detection:** Server validates, not just client - verify API rejects invalid schedules
- [ ] **Notification Cleanup:** Expired subscriptions removed - verify cleanup cron job or endpoint exists
- [ ] **Offline Mode:** Data syncs when connection restored - verify queue and retry logic
- [ ] **Error Boundaries:** User sees friendly message, not crash - verify all async operations have try/catch
- [ ] **Rate Limiting:** Auth endpoints protected - verify IP-based limits prevent brute force
- [ ] **HTTPS:** Force redirect from HTTP - verify production doesn't serve HTTP

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Tokens in localStorage | MEDIUM | 1. Implement HttpOnly cookie auth endpoint. 2. Add frontend migration: check localStorage, call migration endpoint, clear localStorage. 3. Announce: "Please log in again for security update." 4. Force logout after 7 days to clear stragglers. |
| OAuth without state validation | LOW | 1. Generate state with `secrets.token_urlsafe(32)`. 2. Store in Redis (or signed cookie). 3. Validate in callback before token exchange. 4. Deploy immediately - no data migration needed. |
| SQLite without WAL | LOW | 1. Add `PRAGMA journal_mode=WAL` to database.py get_db(). 2. Restart server. 3. WAL files created automatically. 4. No data migration needed. |
| Naive datetime storage | HIGH | 1. Add timezone column to users table. 2. Create migration script: convert existing TEXT times to UTC ISO 8601 assuming server timezone. 3. Update all datetime parsing/storage code. 4. Test extensively - high risk of data loss. |
| Service worker wrong scope | LOW | 1. Move sw.js to root. 2. Update registration path. 3. Call `registration.unregister()` on old SW. 4. Force refresh instructions to users. |
| Monolithic app.js | MEDIUM | 1. Extract one module (start with auth.js). 2. Update HTML script tags. 3. Test thoroughly. 4. Extract next module. 5. Repeat over 2-3 weeks. |
| No OAuth redirect URIs registered | LOW | 1. Add URIs to Google Cloud Console. 2. Deploy with environment variables. 3. No code changes needed. 4. Test OAuth in production. |
| Notification prompt timing | LOW | 1. Remove `Notification.requestPermission()` from init. 2. Add "Enable Notifications" button after first session. 3. Show modal with explanation. 4. Track state to never re-prompt denied users. |
| Drag without preventDefault | LOW | 1. Add `event.preventDefault()` to dragover/dragenter. 2. Deploy immediately. 3. No data migration needed. |
| Schedule algorithm bugs | MEDIUM | 1. Write failing test cases. 2. Fix algorithm. 3. Add validation. 4. Provide regenerate option for affected users. 5. Add error handling for impossible schedules. |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| localStorage tokens | Phase 1: Google OAuth | Audit: No `localStorage.getItem('token')` in code. DevTools: Cookie with HttpOnly flag exists. |
| SQLite multi-instance | Phase 6: Deployment | Deployment config shows single instance. WAL files exist in data directory. |
| OAuth state validation | Phase 1: Google OAuth | Security review: State generation uses `secrets` module. Callback validates before token exchange. |
| Drag preventDefault | Phase 2: Hourly Scheduling | Functional test: Drag task from list to calendar. Drop completes successfully. |
| Notification timing | Phase 4: Notifications | UX review: Permission never requested on initial load. Explanation modal shown before request. |
| Service worker scope | Phase 5: PWA Setup | DevTools: Service worker scope is "/". Works on all routes. |
| Monolithic app.js | Phase 0: Pre-work (Technical Debt) | Code review: Multiple JS files exist. ES6 modules with exports. No global variable collisions. |
| OAuth redirect mismatch | Phase 1: Google OAuth | Integration test: OAuth flow works in all environments (dev/staging/prod). |
| Naive datetimes | Phase 2: Hourly Scheduling | Database audit: All datetime columns store UTC ISO 8601. Timezone conversion in API. |
| Schedule algorithm | Phase 3: Regenerate Roadmap | Unit tests: Edge cases pass. Integration test: Real user schedule validates. Error handling exists. |

## Sources

### Google OAuth Security
- [Truffle Security: Millions at Risk Due to Google OAuth Flaw](https://trufflesecurity.com/blog/millions-at-risk-due-to-google-s-oauth-flaw)
- [Medium: OAuth Gone Wrong](https://medium.com/@instatunnel/oauth-gone-wrong-when-sign-in-with-google-opens-a-pandoras-box-e7cfa048f908)
- [Google Developers: OAuth Best Practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices)
- [PortSwigger: OAuth Authentication Vulnerabilities](https://portswigger.net/web-security/oauth)
- [DeepStrike: OAuth Common Mistakes](https://deepstrike.io/blog/oauth-from-security-perspective-pt-1)

### FastAPI + OAuth Implementation
- [FastAPI Documentation: OAuth2 Scopes](https://fastapi.tiangolo.com/advanced/security/oauth2-scopes/)
- [Medium: FastAPI Authentication with Google OAuth 2.0](https://parlak-deniss.medium.com/fastapi-authentication-with-google-oauth-2-0-9bb93b784eee)
- [GitHub Discussion: Mismatch State Error with FastAPI](https://github.com/fastapi/fastapi/discussions/11732)
- [Hanchon's Blog: Use Google Login with FastAPI and JWT](https://blog.hanchon.live/guides/google-login-with-fastapi-and-jwt/)

### Drag and Drop Implementation
- [DigitalOcean: How To Create Drag and Drop Elements with Vanilla JavaScript](https://www.digitalocean.com/community/tutorials/js-drag-and-drop-vanilla-js)
- [MDN: HTML Drag and Drop API](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API)
- [Medium: Drag-n-Drop with Vanilla JavaScript](https://medium.com/codex/drag-n-drop-with-vanilla-javascript-75f9c396ecd)
- [Stack Abuse: Drag and Drop in Vanilla JavaScript](https://stackabuse.com/drag-and-drop-in-vanilla-javascript/)

### PWA Push Notifications
- [MobileLoud: How to Set Up Push Notifications for Your PWA](https://www.mobiloud.com/blog/pwa-push-notifications)
- [MagicBell: Using Push Notifications in PWAs - Complete Guide](https://www.magicbell.com/blog/using-push-notifications-in-pwas)
- [MDN: PWAs Re-engageable Using Notifications and Push](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Tutorials/js13kGames/Re-engageable_Notifications_Push)
- [Medium: Configuring Push Notifications in a PWA](https://medium.com/@vedantsaraswat_44942/configuring-push-notifications-in-a-pwa-part-1-1b8e9fe2954)

### FastAPI + SQLite Production
- [ZestMinds: FastAPI Deployment Guide 2026](https://www.zestminds.com/blog/fastapi-deployment-guide/)
- [FastLaunchAPI: FastAPI Best Practices for Production 2026](https://fastlaunchapi.dev/blog/fastapi-best-practices-production-2026)
- [Medium: Deploy FastAPI Application with SQLite on Fly.io](https://medium.com/@vladkens/deploy-fastapi-application-with-sqlite-on-fly-io-5ed1185fece1)
- [FastAPI Documentation: SQL Databases](https://fastapi.tiangolo.com/tutorial/sql-databases/)

### Token Security
- [VolcanicMinds: Cookie vs LocalStorage Ultimate Token Security Guide 2026](https://volcanicminds.com/en/insights/cookie-vs-localstorage-security-guide)
- [Wisp CMS: Token Storage - Local Storage vs HttpOnly Cookies](https://www.wisp.blog/blog/understanding-token-storage-local-storage-vs-httponly-cookies)
- [Pivot Point Security: Local Storage Versus Cookies for Session Tokens](https://www.pivotpointsecurity.com/local-storage-versus-cookies-which-to-use-to-securely-store-session-tokens/)
- [Curity Medium: Best Practices for Storing Access Tokens](https://curity.medium.com/best-practices-for-storing-access-tokens-in-the-browser-6b3d515d9814)
- [SuperTokens: Cookies vs LocalStorage for Sessions](https://supertokens.com/blog/cookies-vs-localstorage-for-sessions-everything-you-need-to-know)

### JavaScript Refactoring
- [Medium: How I Built a Modular Frontend Architecture](https://jdavidsmith.medium.com/how-i-built-a-modular-frontend-architecture-using-javascript-from-spaghetti-to-scalable-885c3946e524)
- [Qodo: Refactoring Frontend Code - Turning Spaghetti JavaScript into Modular Components](https://www.qodo.ai/blog/refactoring-frontend-code-turning-spaghetti-javascript-into-modular-maintainable-components/)
- [Medium: Single Page Application - From Monolithic to Modular](https://medium.com/thron-tech/single-page-application-from-monolithic-to-modular-c1d413c10292)
- [Medium: Writing Modular JavaScript](https://medium.com/@jrschwane/writing-modular-javascript-pt-1-b42a3bd23685)

### Calendar Scheduling UI
- [Mobiscroll: JavaScript Scheduler External Drag and Drop](https://demo.mobiscroll.com/scheduler/external-drag-drop)
- [Schedule-X: Drag and Drop Plugin](https://schedule-x.dev/docs/calendar/plugins/drag-and-drop)
- [Eleken: Calendar UI Examples and UX Tips](https://www.eleken.co/blog-posts/calendar-ui)
- [DayPilot: HTML5 Calendar Scheduler Components](https://www.daypilot.org/)

### SQLite Write-Ahead Logging
- [SQLite Official: Write-Ahead Logging](https://sqlite.org/wal.html)
- [Fly.io Blog: How SQLite Scales Read Concurrency](https://fly.io/blog/sqlite-internals-wal/)
- [Medium: Understanding WAL Mode in SQLite](https://mohit-bhalla.medium.com/understanding-wal-mode-in-sqlite-boosting-performance-in-sql-crud-operations-for-ios-5a8bd8be93d2)
- [Steemit: Improve Multithreading Performance with WAL](https://steemit.com/blog/@justyy/improve-multithreading-performance-of-sqlite-database-by-wal-write-ahead-logging)

### Scheduling Algorithms
- [PMI: Common Scheduling Mistakes and How to Avoid Them](https://www.pmi.org/learning/library/common-scheduling-mistakes-avoid-7221)
- [ActiveBatch: Guide to Job Scheduling Algorithms](https://www.advsyscon.com/blog/job-scheduling-algorithms/)
- [Astronomer: 7 Common Debugging Errors in Airflow DAGs](https://www.astronomer.io/blog/7-common-errors-to-check-when-debugging-airflow-dag/)

---
*Pitfalls research for: StudyFlow AI Study Planner*
*Researched: 2026-02-17*
*Next: Use this document during roadmap creation to assign pitfall prevention to appropriate phases*
