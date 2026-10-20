# Phase 6: Google OAuth & Security - Context

**Gathered:** 2026-02-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Add Google Sign-In as an alternative authentication method alongside existing email/password login. Migrate token storage from localStorage to HttpOnly cookies for XSS protection. Implement CSRF protection via OAuth state parameter.

</domain>

<decisions>
## Implementation Decisions

### Login screen experience
- Google Sign-In button appears BELOW the existing email/password form, as an alternative
- Google button only appears on the login screen, NOT on the registration screen
- First-time Google users see a welcome/onboarding screen before reaching the dashboard
- Returning Google users go straight to the dashboard

### Account linking
- If Google email matches an existing email/password account: auto-link (merge automatically)
- After auto-linking, Google replaces password login — only Google sign-in works for that account going forward
- If Google email does NOT match any existing account: auto-create a new StudyFlow account from Google profile data
- No separate registration step needed for Google users

### Session & token handling
- Sessions last 30 days before requiring re-authentication
- Migrate from localStorage tokens to HttpOnly cookies (required by roadmap success criteria)

### Error & edge cases
- If user cancels Google popup/flow: silent return to the regular registration screen, no error message
- Different Google email than registered email: handled by auto-link/auto-create logic above

### Claude's Discretion
- Google button styling (official branding vs app theme)
- "Remember me" checkbox (include or skip for simplicity)
- Token migration experience (silent logout or brief security notice)
- Multi-device session policy (unlimited or capped)
- Auth failure UX (toast vs error page)
- OAuth flow type (redirect vs popup)
- Email mismatch handling for non-matching Google accounts

</decisions>

<specifics>
## Specific Ideas

- User explicitly wants Google to REPLACE password login once linked (not coexist)
- Welcome/onboarding screen specifically for first-time Google sign-ins
- Cancel flow should feel seamless — no error states, just redirect to registration

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 06-google-oauth-security*
*Context gathered: 2026-02-18*
