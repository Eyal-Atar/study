# Project Research Summary

**Project:** StudyFlow - AI-Powered Study Planner
**Domain:** Educational SaaS - Student Productivity & AI-Driven Scheduling
**Researched:** 2026-02-17
**Confidence:** HIGH

## Executive Summary

StudyFlow is an AI-powered study planner that generates personalized, day-by-day study schedules with hourly time slots for students managing multiple exams. The brownfield project is built on FastAPI + SQLite + vanilla JavaScript with Claude API integration, currently preparing for public launch by adding Google OAuth, hourly scheduling, drag-and-drop task management, PWA notifications, and production deployment. Research reveals this is a well-trodden domain with established patterns for web-based scheduling applications, but with critical security and scalability pitfalls that must be addressed before launch.

The recommended approach prioritizes security hardening (migrating from localStorage to HttpOnly cookies, implementing OAuth state validation) and technical debt resolution (refactoring monolithic app.js into modules) BEFORE adding new features. The stack selection favors mature, lightweight technologies: Authlib for OAuth, SortableJS for drag-and-drop, Event Calendar (vkurko/calendar) for hourly scheduling, and native Web Push APIs with pywebpush for notifications. Deployment should target Render with PostgreSQL to avoid SQLite write concurrency issues in multi-instance production environments.

Key risks include OAuth security vulnerabilities (state parameter CSRF, redirect URI mismatches), database concurrency failures (SQLite limitations under load), timezone handling bugs (naive datetime storage), and UX anti-patterns (aggressive notification permission prompts, lack of visual feedback). These are mitigated through battle-tested library choices, comprehensive security measures in the OAuth implementation phase, proper database configuration (WAL mode, single-instance deployment), and user-centered notification timing strategies.

## Key Findings

### Recommended Stack

Research identified production-ready technologies that balance simplicity with security for the FastAPI + vanilla JS architecture. The stack avoids abandoned libraries (python-jose), premium licensing traps (FullCalendar Scheduler), and vendor lock-in (Firebase FCM).

**Core technologies:**
- **Authlib 1.6.8** (OAuth2 client): Official, actively maintained library with built-in FastAPI support, automatic token refresh, and state parameter CSRF protection. Replaces the risky localStorage token pattern with secure session management.
- **PyJWT 2.11.0** (JWT tokens): Production-stable JWT library actively maintained (released Jan 2026). Replaces abandoned python-jose which poses security risks.
- **SortableJS 1.15.7** (drag-and-drop): Zero-dependency vanilla JS library with 29k+ GitHub stars. Works with Tailwind via CDN, supports touch devices, no build step required.
- **Event Calendar** (vkurko/calendar): Free, open-source alternative to FullCalendar Scheduler ($500+/year). 37kb compressed, supports hourly time slots via slotDuration config, zero dependencies.
- **pywebpush 2.2.1 + py-vapid 1.9.4** (push notifications): Standards-based Web Push implementation avoiding Firebase vendor lock-in. Works with native browser Push API (full support in 2026 including iOS Safari).
- **Render + PostgreSQL** (deployment): Managed platform with automatic SSL, built-in PostgreSQL support ($7/month each), zero DevOps overhead. PostgreSQL handles concurrent writes that SQLite cannot support in multi-instance deployments.

**Critical version notes:**
- Install PyJWT with crypto extras: `pip install pyjwt[crypto]` for RSA/ECDSA support
- Enable SQLite WAL mode: `PRAGMA journal_mode=WAL` to prevent database locked errors
- Use gunicorn with uvicorn workers for production: `gunicorn -w 4 -k uvicorn.workers.UvicornWorker`

### Expected Features (From PROJECT.md)

**Must have (table stakes for launch):**
- Google OAuth login - students expect social login, not just email/password
- Hourly time slot scheduling - core UX improvement, students need exact study times
- Task completion tracking - already implemented, critical for progress monitoring
- Multi-exam management - already implemented, table stakes for study planners
- AI roadmap generation - already implemented, core differentiator

**Should have (competitive differentiators):**
- Drag-and-drop task reordering - improves daily schedule adjustment UX
- Regenerate roadmap with natural language input - replaces underused chat feature
- PWA installability - students want phone access without app store friction
- Motivational notifications - Claude-powered engagement, competitive edge
- Customizable study hours - user setting replaces hardcoded 6h limit

**Defer (v2+ features):**
- Google Calendar sync - complex OAuth scope management, not essential for v1
- Admin panel/user management - no multi-tenant needs for v1
- Real-time chat between users - not a social app
- Video/audio content support - PDF focus for v1
- Mobile native app - PWA covers mobile use case

### Architecture Approach

The codebase follows a layered REST API pattern with route-based modular organization. The FastAPI backend is structured by domain (auth, users, exams, tasks, brain) with each module containing routes.py, schemas.py, and optional utils.py. The AI planning engine (ExamBrain) integrates Claude API for intelligent schedule generation with PDF extraction via PyMuPDF. Authentication uses token-based auth with dependency injection, and the single-page vanilla JavaScript frontend communicates via HTTP API.

**Major components:**
1. **API Layer** (`backend/*/routes.py`) - RESTful endpoints with Pydantic validation, dependency-injected current user
2. **ExamBrain** (`backend/brain/exam_brain.py`) - Claude API integration, PDF extraction, prompt engineering, JSON task generation
3. **Scheduler** (`backend/brain/scheduler.py`) - Exclusive zone strategy, day-by-day task allocation (needs rework for hourly slots)
4. **Database Layer** (`backend/server/database.py`) - SQLite connection management, schema initialization, migrations
5. **Frontend SPA** (`frontend/index.html` + `frontend/js/app.js`) - Monolithic 4000+ line vanilla JS file (NEEDS REFACTORING)
6. **Authentication** (`backend/auth/`) - Email/password auth with token generation (will add OAuth)

**Critical technical debt:**
- Monolithic `app.js` (4000+ lines) creates function name collisions and race conditions
- localStorage token storage exposes XSS vulnerability
- No test coverage (manual testing only)
- Scheduler algorithm uses naive datetimes (timezone bugs inevitable)

### Critical Pitfalls

1. **localStorage Token Storage Vulnerability** - Storing auth tokens in localStorage exposes the app to XSS attacks. Any injected JavaScript can exfiltrate tokens and gain full account access. SOLUTION: Migrate to HttpOnly cookies with Secure and SameSite=Strict flags in Phase 1 OAuth implementation.

2. **SQLite Multi-Instance Write Concurrency** - SQLite cannot handle writes from multiple application instances. Platforms like Render/Fly.io default to multiple instances for reliability, causing "database locked" errors and data corruption. SOLUTION: Enable WAL mode (`PRAGMA journal_mode=WAL`), configure single-instance deployment, and plan PostgreSQL migration path.

3. **Google OAuth State Parameter CSRF** - Omitting or improperly validating the OAuth state parameter allows CSRF attacks where attackers trick users into linking attacker's Google account to victim's app account. SOLUTION: Use Authlib which handles state generation and validation automatically with cryptographically secure random values.

4. **Monolithic app.js Feature Collision** - Adding hourly drag-and-drop, OAuth callbacks, notifications to a single 4000+ line file creates impossible debugging and variable scope leaks. SOLUTION: Extract modules BEFORE adding features (auth.js, calendar.js, notifications.js) using ES6 modules or module pattern.

5. **PWA Notification Permission Prompt Timing** - Requesting permissions on app load results in 90%+ rejection rates. Once rejected, re-enabling is buried in browser settings. SOLUTION: Never request on initial load, wait until user completes first study session, show contextual explanation before requesting.

6. **Timezone Naive Storage** - Storing schedule blocks as naive time strings ("14:00") breaks when users travel or daylight saving changes. SOLUTION: Store all times in UTC ISO 8601 format ("2026-02-17T14:00:00Z"), convert to user timezone only for display.

7. **Service Worker Registration Scope** - Service worker at wrong path (e.g., `/js/sw.js`) has limited scope and can't intercept network requests for whole app. SOLUTION: Always place service worker at root (`/sw.js`), never in subdirectories.

8. **OAuth Redirect URI Mismatch** - Google OAuth fails with "redirect_uri_mismatch" because registered URI differs by trailing slash, http vs https, or wrong port. Development works but production breaks. SOLUTION: Register ALL redirect URIs (dev/staging/prod) in Google Cloud Console, use environment variables.

## Implications for Roadmap

Based on research, suggested phase structure prioritizes security and technical debt before feature expansion:

### Phase 0: Technical Debt (Pre-work)
**Rationale:** Refactoring monolithic app.js BEFORE adding OAuth, hourly scheduling, and notifications prevents function name collisions and debugging nightmares. Research shows attempting feature additions to 4000+ line files creates unmaintainable code with scope leaks.
**Delivers:** Modular frontend architecture with auth.js, calendar.js, tasks.js, notifications.js extracted using ES6 modules
**Avoids:** Pitfall #7 (Monolithic app.js feature collision)
**Duration:** 3-5 days
**Research flag:** Standard refactoring patterns, skip deep research

### Phase 1: Google OAuth + Security Hardening
**Rationale:** OAuth security vulnerabilities must be addressed from day one, not discovered post-launch. Research shows state parameter validation, HttpOnly cookie storage, and redirect URI configuration are commonly skipped, leading to critical security issues.
**Delivers:** Google Sign-In button, OAuth callback handling, secure token storage (HttpOnly cookies), state parameter CSRF protection, all redirect URIs registered
**Addresses:** Must-have feature (Google OAuth login)
**Avoids:** Pitfall #1 (localStorage vulnerability), Pitfall #3 (OAuth state CSRF), Pitfall #8 (redirect URI mismatch)
**Uses:** Authlib 1.6.8, PyJWT 2.11.0
**Duration:** 5-7 days
**Research flag:** Well-documented OAuth patterns, Authlib handles state validation automatically, minimal additional research needed

### Phase 2: Hourly Time Slot Scheduling
**Rationale:** Core UX improvement that unblocks drag-and-drop features. Must implement proper timezone handling and UTC storage from start to avoid data corruption pitfalls discovered in research.
**Delivers:** Hourly task scheduling UI (Event Calendar), time slot assignment (08:00-11:00), timezone-aware storage (UTC ISO 8601), updated scheduler algorithm, customizable daily study hours setting
**Addresses:** Must-have feature (hourly scheduling), should-have (customizable study hours)
**Avoids:** Pitfall #9 (timezone naive storage)
**Implements:** Calendar component integration, scheduler algorithm rework (exclusive zone strategy with hourly slots)
**Uses:** Event Calendar (vkurko/calendar), datetime UTC conversion
**Duration:** 7-10 days
**Research flag:** NEEDS RESEARCH - exclusive zone algorithm redesign (morning mock test → hobby break → review → practice), calendar library integration patterns, timezone handling best practices

### Phase 3: Drag & Drop Task Management
**Rationale:** Builds on hourly scheduling, provides intuitive schedule adjustment UX. Research shows HTML5 drag-and-drop has non-obvious preventDefault() requirements that cause silent failures.
**Delivers:** Drag tasks between time slots, drag tasks up/down in daily list, visual feedback (highlight drop zones), optimistic UI updates with rollback on failure
**Addresses:** Should-have feature (drag-and-drop task reordering)
**Avoids:** Pitfall #4 (preventDefault() omission), UX pitfall (no visual feedback)
**Uses:** SortableJS 1.15.7 for list reordering, Event Calendar drag-and-drop for time slot moves
**Duration:** 4-6 days
**Research flag:** Standard drag-and-drop patterns, library documentation sufficient, skip deep research

### Phase 4: Regenerate Roadmap Feature
**Rationale:** Replaces underused "Talk to Brain" chat with more intuitive global regeneration. Requires scheduler algorithm testing to avoid pitfall #10 (untested exclusive zone strategy producing invalid schedules).
**Delivers:** Global "Regenerate Roadmap" input, natural language schedule adjustments, exclusive zone strategy redesign (mock test → hobby → review → practice), comprehensive scheduler tests
**Addresses:** Should-have feature (regenerate with natural language)
**Avoids:** Pitfall #10 (exclusive zone algorithm not tested)
**Implements:** ExamBrain prompt updates, scheduler validation, error handling for impossible schedules
**Duration:** 5-7 days
**Research flag:** NEEDS RESEARCH - test case design for scheduling algorithms (no available slots, tight deadlines, midnight crossover), fallback strategies

### Phase 5: PWA + Push Notifications
**Rationale:** PWA installability and notifications are competitive features but require careful UX design. Research shows aggressive permission prompts damage user trust permanently.
**Delivers:** Service worker at root path, Web App Manifest, offline support, push notification subscription, motivational notifications (Claude-powered), contextual permission request after first study session
**Addresses:** Should-have features (PWA, motivational notifications)
**Avoids:** Pitfall #5 (notification permission timing), Pitfall #6 (service worker scope)
**Uses:** Native Service Worker API, pywebpush 2.2.1, py-vapid 1.9.4
**Duration:** 6-8 days
**Research flag:** Standard PWA patterns, service worker caching strategies need review, notification content generation (Claude prompts)

### Phase 6: Production Deployment
**Rationale:** Final phase addresses database concurrency, CORS configuration, and environment setup. Research shows SQLite write conflicts are inevitable in multi-instance production without WAL mode or PostgreSQL migration.
**Delivers:** Render deployment, PostgreSQL migration (or WAL + single-instance config), environment variables (OAuth, JWT secret, VAPID keys), CORS configuration, HTTPS enforcement, rate limiting on auth endpoints
**Addresses:** Must-have (production deployment), security hardening
**Avoids:** Pitfall #2 (SQLite multi-instance), security pitfalls (CORS, rate limiting, HTTPS)
**Uses:** Render platform, PostgreSQL (or SQLite with WAL), gunicorn + uvicorn
**Duration:** 5-7 days
**Research flag:** Deployment-specific research needed (Render configuration, PostgreSQL migration strategy, environment setup)

### Phase Ordering Rationale

- **Phase 0 before all others:** Refactoring monolithic app.js first prevents compounding technical debt when adding OAuth, hourly scheduling, drag-and-drop, and notifications. Research shows feature additions to large monolithic files create unmaintainable codebases.
- **OAuth before scheduling:** Security vulnerabilities must be addressed immediately, and OAuth requires authentication flow changes that would conflict with feature development. HttpOnly cookie migration affects all subsequent API interactions.
- **Hourly scheduling before drag-and-drop:** Drag-and-drop depends on hourly time slot data structure. Calendar UI must exist before tasks can be dragged to specific time slots.
- **Regenerate before PWA:** Scheduler algorithm must be tested and validated before adding notifications that rely on accurate schedules. PWA is presentation layer that doesn't block core functionality.
- **Deployment last:** Infrastructure setup requires all features complete to configure correctly (OAuth redirect URIs, CORS origins, notification endpoints).

### Research Flags

**Phases needing deeper research during planning:**
- **Phase 2 (Hourly Scheduling):** Exclusive zone algorithm redesign with new strategy (mock test → hobby → review → practice), timezone handling edge cases, Event Calendar integration patterns
- **Phase 4 (Regenerate Roadmap):** Scheduling algorithm test case design, fallback strategies for impossible schedules, edge cases (no available time, midnight crossover, multiple exams same day)
- **Phase 6 (Deployment):** Render-specific configuration, PostgreSQL migration strategy (schema conversion, connection pooling), environment variable management

**Phases with standard patterns (skip research-phase):**
- **Phase 0 (Technical Debt):** JavaScript refactoring to ES6 modules is well-documented
- **Phase 1 (OAuth):** Authlib documentation comprehensive, OAuth patterns established
- **Phase 3 (Drag & Drop):** SortableJS and HTML5 drag-and-drop have clear documentation
- **Phase 5 (PWA):** Service worker patterns and Web Push API well-documented by MDN

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All recommended libraries have recent releases (Feb 2026), official documentation, and active maintenance. Version compatibility verified across FastAPI ecosystem. |
| Features | MEDIUM | Feature list derived from PROJECT.md (validated requirements) but lacks detailed user research. Table stakes features identified through domain analysis. |
| Architecture | HIGH | Existing codebase architecture analyzed directly. Patterns match FastAPI best practices. Technical debt clearly identified in code review. |
| Pitfalls | HIGH | Security vulnerabilities sourced from official Google OAuth docs, PortSwigger web security research, and FastAPI community discussions. Common mistakes well-documented across multiple sources. |

**Overall confidence:** HIGH

### Gaps to Address

- **Feature prioritization validation:** PROJECT.md lists features but doesn't indicate relative importance beyond must/should/defer. During roadmap planning, validate with stakeholder which should-have features are truly required for launch vs. nice-to-have.

- **Scheduler algorithm complexity:** Exclusive zone strategy redesign (mock test → hobby → review → practice) lacks detailed specification. Needs design work during Phase 2 planning to define exact time allocation rules, break durations, and conflict resolution.

- **PostgreSQL vs SQLite decision point:** Research recommends PostgreSQL for production but PROJECT.md constraints specify "SQLite for v1". During Phase 6 planning, decide whether to proceed with SQLite + WAL + single-instance deployment (simpler) or migrate to PostgreSQL (more scalable). Decision impacts deployment timeline.

- **Claude API token budget for notifications:** Motivational notifications use Claude API, but no specification exists for notification frequency, content caching strategy, or token usage limits. Needs design during Phase 5 planning to prevent unexpected API costs.

- **Testing strategy:** Research identifies critical test cases (scheduler edge cases, OAuth flows, drag-and-drop) but PROJECT.md notes "no tests exist". Roadmap should allocate time for test infrastructure setup, not just feature development. Consider whether testing happens per-phase or as dedicated testing phase.

## Sources

### Primary (HIGH confidence)
- [Authlib FastAPI OAuth Client - Official Docs](https://docs.authlib.org/en/latest/client/fastapi.html) - OAuth2 implementation patterns, state validation
- [Authlib PyPI](https://pypi.org/project/authlib/) - Version 1.6.8 released Feb 14, 2026
- [PyJWT PyPI](https://pypi.org/project/PyJWT/) - Version 2.11.0 released Jan 30, 2026
- [OAuth2 with JWT tokens - FastAPI Official](https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/) - Token generation, validation patterns
- [SortableJS GitHub](https://github.com/SortableJS/Sortable) - Drag-and-drop library, 29k+ stars
- [pywebpush PyPI](https://pypi.org/project/pywebpush/) - Version 2.2.1 released Feb 9, 2026
- [Google Developers: OAuth Best Practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices) - State parameter, redirect URI security
- [MDN: HTML Drag and Drop API](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API) - preventDefault() requirements
- [MDN: PWAs Re-engageable Using Notifications and Push](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Tutorials/js13kGames/Re-engageable_Notifications_Push) - Service worker scope, push notifications
- [SQLite Official: Write-Ahead Logging](https://sqlite.org/wal.html) - WAL mode, concurrent writes

### Secondary (MEDIUM confidence)
- [FastAPI Best Practices for Production: Complete 2026 Guide](https://fastlaunchapi.dev/blog/fastapi-best-practices-production-2026) - Production deployment patterns
- [Truffle Security: Millions at Risk Due to Google OAuth Flaw](https://trufflesecurity.com/blog/millions-at-risk-due-to-google-s-oauth-flaw) - OAuth security vulnerabilities
- [VolcanicMinds: Cookie vs LocalStorage Ultimate Token Security Guide 2026](https://volcanicminds.com/en/insights/cookie-vs-localstorage-security-guide) - Token storage security
- [Railway vs Fly.io vs Render Comparison](https://medium.com/ai-disruption/railway-vs-fly-io-vs-render-which-cloud-gives-you-the-best-roi-2e3305399e5b) - Deployment platform comparison
- [Event Calendar GitHub](https://github.com/vkurko/calendar) - Free FullCalendar alternative, hourly scheduling
- [Time to Abandoned Python-Jose - FastAPI Discussion](https://github.com/fastapi/fastapi/discussions/11345) - Community consensus on PyJWT vs python-jose
- [DigitalOcean: How To Create Drag and Drop Elements with Vanilla JavaScript](https://www.digitalocean.com/community/tutorials/js-drag-and-drop-vanilla-js) - Drag-and-drop implementation
- [MagicBell: Using Push Notifications in PWAs - Complete Guide](https://www.magicbell.com/blog/using-push-notifications-in-pwas) - PWA notification patterns

### Tertiary (LOW confidence)
- Event Calendar specific version numbers - GitHub releases should be checked before implementation
- httpx-oauth version 0.16.1 - may have newer version by launch, check PyPI

---
*Research completed: 2026-02-17*
*Ready for roadmap: yes*
