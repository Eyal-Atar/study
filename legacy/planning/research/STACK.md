# Stack Research

**Domain:** AI-powered study planner (StudyFlow) - Adding authentication, scheduling, notifications, and deployment
**Researched:** 2026-02-17
**Confidence:** HIGH

## Recommended Stack

### Google OAuth Authentication

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **Authlib** | 1.6.8 | OAuth2 client library for FastAPI | Official, actively maintained (released Feb 14, 2026). Provides async-first OAuth2 implementation with built-in Starlette/FastAPI support. More comprehensive than httpx-oauth, handles token refresh automatically. |
| **PyJWT** | 2.11.0 | JWT token generation and validation | Production-stable (released Jan 30, 2026). Python-jose is ABANDONED (last update 3 years ago). PyJWT is the current standard with simpler API and active maintenance. |
| **httpx-oauth** | 0.16.1 | Alternative async OAuth client | Lighter weight option if you only need OAuth (no OpenID Connect). Good for simple use cases. Less feature-complete than Authlib. |

**Recommendation:** Use **Authlib 1.6.8** for production. It's the most robust, handles edge cases, and supports both OAuth2 and OpenID Connect. Only use httpx-oauth if you need absolute minimal dependencies.

### Drag & Drop Task Management

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **SortableJS** | 1.15.7 | Vanilla JS drag-and-drop library | Zero dependencies, works with CDN (no build step), supports touch devices, actively maintained (released Feb 2026). Most popular vanilla JS solution with 29k+ GitHub stars. |
| **Event Calendar** (vkurko/calendar) | Latest | Lightweight drag-and-drop calendar | Free, open-source, 37kb compressed, zero dependencies. Excellent alternative to FullCalendar's premium scheduler. Supports drag-and-drop events. |
| **Schedule-X** | Latest | Modern event calendar | Modern architecture, works with vanilla JS, React, Angular, Vue. Good for future framework migration if needed. |

**Recommendation:** Use **SortableJS** for task reordering (drag tasks up/down in lists). For hourly time slot scheduling with drag-and-drop, use **Event Calendar** (vkurko/calendar) - it's free, lightweight, and specifically built for this use case.

### PWA & Push Notifications

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **Service Worker API** | Native | Offline support, background sync | Native browser API, no library needed. All major browsers support in 2026 including iOS Safari for installed PWAs. |
| **Web App Manifest** | Native | PWA installability | Native browser feature. Just need a `.webmanifest` file. No build tools required. |
| **pywebpush** | 2.2.1 | Server-side web push notifications | Official Python library (released Feb 9, 2026). Handles encryption and VAPID authentication. Works with FastAPI. |
| **py-vapid** | 1.9.4 | VAPID key generation | Required for pywebpush. Generates authentication keys for push server identification. Released Jan 5, 2026. |

**Why NOT use Firebase Cloud Messaging (FCM):** FCM adds third-party dependency and complexity. Native Web Push API is now mature with full browser support. Keep it simple - use native APIs with pywebpush on backend.

### Hourly Time Slot Scheduling

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **Event Calendar** (vkurko/calendar) | Latest | Visual hourly scheduler | Free, zero dependencies, 37kb. Supports timeline views and hourly slots via `slotDuration` config. Can integrate with existing Tailwind design. |
| **FullCalendar** (core) | v6 | Industry standard calendar | Core features are open-source and free. Scheduler plugin is PAID ($500+). Not recommended unless you need premium features. |
| **Schedule-X** | Latest | Modern alternative | Free, open-source, modern API. Good developer experience. Active development. |

**Recommendation:** Use **Event Calendar** (vkurko/calendar). It's free, lightweight, and has all the features you need for hourly scheduling without the premium price tag of FullCalendar Scheduler.

### Production Deployment

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **Render** | - | Managed hosting platform | Easiest deployment, automatic SSL, built-in PostgreSQL support, straightforward pricing ($7/month for web service). Best for FastAPI ASGI apps. Zero DevOps required. |
| **Fly.io** | - | Edge computing platform | Best for low-latency global apps. Runs on bare metal with SQLite support. More complex setup. Good for advanced users. |
| **Railway** | - | Developer-focused platform | Fast prototyping, template-based setup. Usage-based pricing - watch idle costs. Good for startups. |

**SQLite vs PostgreSQL in Production:**
- **SQLite limitation:** Cannot handle concurrent writes from multiple processes. Fly.io defaults to 2 instances = write conflicts.
- **For public launch:** Migrate to PostgreSQL. Render provides managed PostgreSQL ($7/month for 256MB).
- **SQLite is OK for:** Single-instance deployments, read-heavy workloads, <100 concurrent users.

**Recommendation:** Deploy to **Render** with **PostgreSQL** for production. Render provides the best balance of simplicity, reliability, and cost for FastAPI apps. PostgreSQL handles concurrent writes and scales to thousands of users.

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **python-multipart** | 0.0.9 (current) | File upload handling | Already in your stack. No changes needed. For production, set max_length in File() params to limit upload size. Configure nginx client_max_body_size for large files. |
| **uvicorn[standard]** | 0.30.6+ | ASGI server | Already in your stack. Use with gunicorn for production: `gunicorn -w 4 -k uvicorn.workers.UvicornWorker`. |
| **python-dotenv** | 1.0.1 (current) | Environment variable management | Already in your stack. Perfect for OAuth credentials. |
| **cryptography** | Latest | Cryptographic operations | Required for PyJWT with RSA/ECDSA. Install: `pip install pyjwt[crypto]`. Optional but recommended for production. |

## Installation

```bash
# Google OAuth & JWT
pip install authlib==1.6.8
pip install pyjwt[crypto]==2.11.0

# Web Push Notifications (backend)
pip install pywebpush==2.2.1
pip install py-vapid==1.9.4

# Production server
pip install "uvicorn[standard]==0.30.6"
pip install gunicorn

# Database migration for production
pip install asyncpg  # for async PostgreSQL support
pip install sqlalchemy[asyncio]  # if using SQLAlchemy ORM
```

**Frontend (CDN - no installation):**
```html
<!-- Drag & Drop -->
<script src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.7/Sortable.min.js"></script>

<!-- Calendar for hourly scheduling -->
<script src="https://cdn.jsdelivr.net/npm/@event-calendar/core@3.9.0/index.global.min.js"></script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@event-calendar/core@3.9.0/index.min.css">

<!-- PWA - No libraries needed, use native Service Worker API -->
```

## Alternatives Considered

| Category | Recommended | Alternative | Why Not Alternative |
|----------|-------------|-------------|---------------------|
| OAuth Library | Authlib | httpx-oauth | httpx-oauth is lighter but lacks token refresh, OpenID Connect support, and advanced OAuth2 flows. Choose httpx-oauth only for simplest use cases. |
| JWT Library | PyJWT | python-jose | python-jose is ABANDONED (3 years no updates). Security risk. PyJWT is actively maintained and industry standard. |
| Drag & Drop | SortableJS | DragonflyJS, Dragster | Others are less maintained, fewer features, smaller communities. SortableJS is battle-tested with 29k stars. |
| Calendar | Event Calendar | FullCalendar Scheduler | FullCalendar Scheduler costs $500+/year. Event Calendar is free and has same core features. |
| Push Notifications | pywebpush + native API | Firebase FCM, OneSignal | Third-party services add complexity, vendor lock-in, potential costs. Native Web Push is mature and free. |
| Deployment | Render | AWS, DigitalOcean | AWS requires extensive DevOps knowledge. DigitalOcean needs manual SSL, database setup. Render is managed, automatic, and cost-effective. |
| Production DB | PostgreSQL | SQLite | SQLite has write concurrency limits. PostgreSQL scales to millions of users, handles concurrent writes, required for multi-instance deployments. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **python-jose** | Abandoned 3 years ago. Security vulnerability risk. Last commit ~1 year ago. | **PyJWT 2.11.0** - actively maintained, simpler API, production-stable |
| **FullCalendar Scheduler** | $500+/year premium license. Overkill for this project. | **Event Calendar** (vkurko/calendar) - free, open-source, same features |
| **jQuery** | Outdated, unnecessary with vanilla JS. Adds 87kb overhead. | **Vanilla JavaScript** - faster, smaller, more maintainable |
| **Firebase FCM for web push** | Vendor lock-in, complexity. Native Web Push API works everywhere now. | **pywebpush + native Push API** - standards-based, no vendor dependency |
| **fastapi-authlib package** | Discontinued, no updates in 12+ months. | **Authlib directly** - official library with built-in FastAPI support |
| **SQLite in production (multi-instance)** | Write conflicts with multiple processes. Fly.io defaults to 2 instances. | **PostgreSQL** - handles concurrency, scales horizontally |
| **passlib with bcrypt** | Outdated recommendation. Slow on modern systems. | Built-in `fastapi.security` with OAuth2 + JWT (no passwords stored locally) |
| **Session-based auth** | Doesn't scale, requires sticky sessions or Redis. | **Stateless JWT tokens** - scalable, works with multiple instances |

## Stack Patterns by Variant

**If deploying to a single instance (hobby project):**
- Use SQLite (already in your stack)
- Deploy to Render free tier or Fly.io hobby tier
- Because: SQLite works fine for single-process, <100 users
- Trade-off: Can't scale horizontally

**If targeting public launch (100+ users):**
- Migrate to PostgreSQL (Render managed PostgreSQL $7/mo)
- Deploy to Render with at least 2 instances for redundancy
- Because: Need write concurrency, horizontal scaling, reliability
- Trade-off: $14/mo minimum (web + database)

**If you need global low-latency:**
- Deploy to Fly.io with regional databases
- Use read replicas for distributed reads
- Because: Fly.io runs on edge, SQLite in ephemeral VMs with LiteFS replication
- Trade-off: More complex setup, requires infrastructure knowledge

**If users need offline-first app:**
- Implement full PWA with background sync
- Use IndexedDB for client-side storage
- Service Worker for request queueing
- Because: Students study without internet (libraries, commutes)
- Trade-off: More complex client-side state management

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| authlib@1.6.8 | fastapi@0.115.0 | ✅ Built-in Starlette support, works perfectly with FastAPI |
| pyjwt@2.11.0 | cryptography@latest | ✅ Requires cryptography for RSA/ECDSA algorithms |
| pywebpush@2.2.1 | py-vapid@1.9.4 | ✅ py-vapid is a dependency of pywebpush |
| uvicorn@0.30.6 | fastapi@0.115.0 | ✅ Already in your stack, no conflicts |
| sortablejs@1.15.7 | Vanilla JS / Tailwind | ✅ Zero dependencies, works with any CSS framework |
| Event Calendar | Vanilla JS / Tailwind | ✅ No framework dependencies, integrates with existing design |

**Important:** When using PyJWT with RSA signatures, install with crypto extras: `pip install pyjwt[crypto]`. Otherwise you'll get runtime errors on RSA/ECDSA operations.

## Security Considerations

### OAuth Security
- Store `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in environment variables (never commit)
- Use HTTPS in production (Render provides automatic SSL)
- Set OAuth redirect URIs to production domain only (no wildcards)
- Implement CSRF protection with state parameter (Authlib does this automatically)

### JWT Security
- Use strong secret key (256-bit minimum): `openssl rand -hex 32`
- Set short expiration times (1 hour for access tokens, 7 days for refresh)
- Store refresh tokens securely (httpOnly cookies, not localStorage)
- Rotate keys periodically in production

### PWA Security
- Service Workers only work over HTTPS (except localhost)
- Validate push subscription endpoints before storing
- Never expose VAPID private key in frontend code
- Implement subscription verification on backend

### File Upload Security
- Set max file size in FastAPI: `File(..., max_length=10*1024*1024)` for 10MB limit
- Configure nginx `client_max_body_size` to match
- Validate PDF magic bytes, not just file extension
- Store uploads outside web root or use object storage (S3, Cloudinary)

## Performance Optimizations

### Frontend
- Load SortableJS and Event Calendar via CDN with `defer` attribute
- Lazy-load Service Worker registration after page load
- Use `link rel="preconnect"` for Google OAuth endpoints
- Compress images in PWA manifest (PNG → WebP, <512KB)

### Backend
- Use connection pooling for PostgreSQL: `pool_size=20, max_overflow=0`
- Cache JWT public keys (if using RSA): `@lru_cache(maxsize=1)`
- Implement rate limiting on OAuth callback endpoints
- Use async database queries with asyncpg for PostgreSQL

### Deployment
- Enable gzip compression in uvicorn: `--proxy-headers --forwarded-allow-ips='*'`
- Use gunicorn with 2-4 workers: `gunicorn -w 4 -k uvicorn.workers.UvicornWorker`
- Set up CDN for static assets (Cloudflare free tier)
- Enable HTTP/2 on Render (automatic)

## Migration Path

### Phase 1: Add Authentication (Week 1)
1. Install authlib and pyjwt
2. Create `/auth/google` and `/auth/callback` endpoints
3. Set up JWT token generation and validation
4. Add protected route middleware
5. Update frontend with Google Sign-In button

### Phase 2: Add Drag & Drop (Week 1)
1. Add SortableJS via CDN
2. Initialize Sortable on task list elements
3. Add API endpoint for task reordering: `PATCH /tasks/{id}/order`
4. Implement optimistic UI updates
5. Handle drag failures with rollback

### Phase 3: Add Hourly Scheduling (Week 2)
1. Add Event Calendar library via CDN
2. Create calendar view in dashboard
3. Implement hourly slot configuration (`slotDuration: '01:00:00'`)
4. Add task scheduling API: `PATCH /tasks/{id}/schedule`
5. Sync with AI roadmap generation

### Phase 4: Add PWA & Notifications (Week 2)
1. Create `manifest.webmanifest` file
2. Implement Service Worker with cache strategies
3. Add VAPID key generation: `vapid --gen`
4. Install pywebpush and py-vapid
5. Create subscription endpoint: `POST /push/subscribe`
6. Implement notification triggers (exam reminders, task due dates)

### Phase 5: Production Deployment (Week 3)
1. Sign up for Render account
2. Create PostgreSQL database on Render
3. Update database connection from SQLite to PostgreSQL
4. Configure environment variables (OAuth, JWT secret, VAPID keys)
5. Deploy FastAPI app with `render.yaml` blueprint
6. Set up custom domain and SSL
7. Configure CORS for production domain
8. Test OAuth flow with production URLs

## Sources

### High Confidence (Official Documentation & Recent Releases)
- [Authlib FastAPI OAuth Client - Official Docs](https://docs.authlib.org/en/latest/client/fastapi.html) - Authlib 1.6.6 documentation
- [Authlib PyPI](https://pypi.org/project/authlib/) - Version 1.6.8, released Feb 14, 2026
- [PyJWT PyPI](https://pypi.org/project/PyJWT/) - Version 2.11.0, released Jan 30, 2026
- [OAuth2 with JWT tokens - FastAPI](https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/) - Official FastAPI tutorial
- [SortableJS GitHub](https://github.com/SortableJS/Sortable) - 29k+ stars, actively maintained
- [SortableJS npm](https://www.npmjs.com/package/sortablejs) - Version 1.15.7
- [pywebpush PyPI](https://pypi.org/project/pywebpush/) - Version 2.2.1, released Feb 9, 2026
- [py-vapid PyPI](https://pypi.org/project/py-vapid/) - Version 1.9.4, released Jan 5, 2026

### Medium Confidence (Recent Articles & Guides)
- [FastAPI Best Practices for Production: Complete 2026 Guide](https://fastlaunchapi.dev/blog/fastapi-best-practices-production-2026) - Production deployment patterns
- [Integrating Google Authentication with FastAPI: A Step-by-Step Guide](https://blog.futuresmart.ai/integrating-google-authentication-with-fastapi-a-step-by-step-guide) - OAuth2 implementation
- [Time to Abandoned Python-Jose - FastAPI Discussion](https://github.com/fastapi/fastapi/discussions/11345) - Community consensus on PyJWT vs python-jose
- [Railway vs Fly.io vs Render Comparison](https://medium.com/ai-disruption/railway-vs-fly-io-vs-render-which-cloud-gives-you-the-best-roi-2e3305399e5b) - Platform comparison
- [FastAPI deployment options - Render](https://render.com/articles/fastapi-deployment-options) - Deployment guide
- [Using Push Notifications in PWAs: The Complete Guide](https://www.magicbell.com/blog/using-push-notifications-in-pwas) - PWA implementation
- [MDN: Make PWAs re-engageable using Notifications and Push APIs](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Tutorials/js13kGames/Re-engageable_Notifications_Push) - Official MDN guide
- [Event Calendar GitHub](https://github.com/vkurko/calendar) - Free FullCalendar alternative
- [Schedule-X](https://schedule-x.dev/) - Modern calendar library
- [How to Build a PWA in Vanilla JavaScript - DigitalOcean](https://www.digitalocean.com/community/tutorials/js-vanilla-pwa) - PWA implementation guide

### Low Confidence (Needs Validation)
- httpx-oauth version 0.16.1 - last updated Dec 2024, may have newer version by launch
- Event Calendar specific version numbers - GitHub releases should be checked before implementation

---
*Stack research for: StudyFlow AI Study Planner - Feature Expansion Phase*
*Researched: February 17, 2026*
*Next Step: Use this stack to create detailed roadmap with phases, tasks, and timelines*
