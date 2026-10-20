---
status: resolved
trigger: "iOS PWA bottom tab bar has visible dark gap between nav and screen edge"
created: 2026-03-10T00:00:00Z
updated: 2026-03-14T17:00:00Z
---

## Current Focus

hypothesis: The ::after pseudo-element (z-index:-1) was painting BEHIND its parent's background, making it invisible on iOS. The flex approach alone has rounding/subpixel gaps on real iOS devices.
test: Fixed ::after to z-index:9999 with pointer-events:none, added body::after as second safety net. Deploy v61 and verify on real iPhone.
expecting: No gap between tab bar and screen bottom
next_action: User verification on iOS device (must delete and re-add PWA to home screen if manifest cached)

## Symptoms

expected: Bottom nav bar background extends seamlessly to screen bottom edge. Icons/text padded above home indicator.
actual: Dark gap visible between tab bar and screen bottom edge on iPhones with home indicator.
errors: None (CSS/layout only)
reproduction: Open PWA on any iPhone with home indicator (no physical home button). Visible on all tabs.
started: Has been present through multiple fix attempts.

## Eliminated

- hypothesis: Using 100dvh instead of position:fixed causes gap
  evidence: Changed to position:fixed; inset:0 - gap remained
  timestamp: pre-session

- hypothesis: Tab bar background color wrong
  evidence: Changed to solid #0B0F1A - gap remained
  timestamp: pre-session

- hypothesis: Status bar style causing layout shift
  evidence: Changed to black-translucent - fixed top but bottom gap remained
  timestamp: pre-session

- hypothesis: position:fixed bottom:0 with padding-bottom for safe area should work
  evidence: Multiple attempts with this approach all failed - iOS PWA does not extend fixed element backgrounds into safe area region
  timestamp: 2026-03-11

- hypothesis: Flex-child tab bar with ::after z-index:-1 pseudo-element fixes the gap
  evidence: User confirmed gap STILL exists on real iPhone 14 Pro with this approach. Works in desktop responsive sim but not on actual device. The ::after with z-index:-1 paints behind its parent (CSS stacking context rule - negative z-index child goes behind parent's background), making it invisible.
  timestamp: 2026-03-11

## Evidence

- timestamp: 2026-03-11T00:01:00Z
  checked: CSS layout model for #mobile-tab-bar
  found: "Tab bar was position:fixed;bottom:0 with padding-bottom:env(safe-area-inset-bottom). This takes the element OUT of the flex flow of #screen-dashboard.active (which is a flex column container with inset:0)."
  implication: "As a fixed element, the tab bar's bottom:0 on iOS PWA may not correspond to the physical screen bottom. The flex container extends to the physical bottom via inset:0, but the fixed child doesn't inherit this."

- timestamp: 2026-03-11T00:02:00Z
  checked: iOS PWA community solutions for safe area bottom gap
  found: "Common solutions: (1) make bottom bar a flex child with padding-bottom for safe area, (2) use ::after pseudo-element to extend background, (3) use inset:0 on root elements instead of width/height:100%"
  implication: "The flex-child approach is the most natural fix - the dashboard container already has the correct flex layout, just needs the tab bar to participate in it."

- timestamp: 2026-03-11T00:03:00Z
  checked: html,body styling
  found: "Was using width:100%;height:100% which may not include safe areas on all iOS versions"
  implication: "Changed to inset:0 which explicitly covers full viewport including safe areas"

- timestamp: 2026-03-11T12:00:00Z
  checked: Why ::after pseudo-element with z-index:-1 fails on real iOS device
  found: "CSS stacking context: #mobile-tab-bar has z-index:50 which creates a stacking context. Its ::after child with z-index:-1 paints BEHIND the parent's own background per CSS spec. Since both have background:#0B0F1A, the ::after is completely hidden by the parent. On desktop responsive mode env(safe-area-inset-bottom) returns 0px so there's nothing to fill. On real iOS the ::after has height but is invisible behind the parent."
  implication: "The safety net pseudo-element never actually worked. The flex approach alone has a subpixel or rendering gap on real iOS WebKit. Need the ::after to paint ON TOP (z-index:9999, pointer-events:none) to actually cover any gap."

## Resolution

root_cause: Three compounding issues — (1) `position:fixed; bottom:0` on the tab bar didn't reliably extend into the iOS safe area. (2) `body { position:fixed; inset:0 }` on iOS constrains the viewport and prevents children from reaching the physical screen edge. (3) Previous ::after pseudo-element hacks were either invisible (z-index:-1) or unreliable.

fix: |
  Final fix (2026-03-14):
  1. Made #mobile-tab-bar a flex child (position:relative; flex-shrink:0) instead of position:fixed
     — naturally sits at the bottom of the #screen-dashboard flex column
  2. Removed position:fixed from body — changed to height:100%; width:100%
     — iOS no longer constrains the viewport to safe area boundaries
  3. Changed #screen-dashboard.active to use height:100dvh instead of bottom:0
     — 100dvh on iOS with viewport-fit=cover extends to the physical screen bottom
  4. Tab bar padding-bottom:env(safe-area-inset-bottom) fills the home indicator area seamlessly
  5. Removed extra padding-bottom:60px from content panels (tab bar no longer overlaps)

verification: User confirmed FIXED on real iPhone — 2026-03-14
files_changed:
  - frontend/css/styles.css (tab bar layout, body positioning, dashboard height, panel padding)
