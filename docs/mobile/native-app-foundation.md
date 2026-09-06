# Alpha Traders native app foundation

Status: private-beta client implemented; signed device distribution and
real-device acceptance remain pending.

## Product decision

Build one Expo/React Native TypeScript app for iOS and Android, using Expo Router
for navigation. Keep the existing Next.js application as the backend and web
experience. Keep owner/admin operations web-only for the first native release.

This gives the app one shared UI codebase while preserving the marketplace's
existing business rules, database, audit log, and bilingual domain model.

Primary references:

- [Expo authentication overview](https://docs.expo.dev/develop/authentication/)
- [Expo Router authentication](https://docs.expo.dev/router/advanced/authentication/)
- [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/)
- [EAS Build](https://docs.expo.dev/build/introduction/)

## What can be reused

- Marketplace and trade lifecycle rules in the Next.js server layer.
- Existing English and Arabic product language and RTL behavior.
- Public listings, seller profiles, reviews, trade rooms, notifications, and
  account/profile APIs after the mobile API gates below are complete.
- Pure TypeScript domain types and validation once extracted into a package
  without `next/*`, Node-only, or server-only imports.
- Existing brand assets and the black/gold visual system.

Web React components should not be copied into React Native. Share contracts,
business rules, design tokens, and copy; implement native screens with native
controls and accessibility semantics.

## Pre-app API gates

These are release blockers, not optional polish.

### 1. Versioned device authentication

The current application session is an opaque token stored only in an HTTP-only
browser cookie. A native client needs an explicit device-session contract.

Target endpoints:

- `POST /api/mobile/v1/auth/login`
- `POST /api/mobile/v1/auth/refresh`
- `GET /api/mobile/v1/auth/me`
- `DELETE /api/mobile/v1/auth/session`

Target behavior:

- Return short-lived access tokens and rotated refresh tokens only from the
  mobile auth surface.
- Store only token hashes and device/session metadata server-side.
- Accept `Authorization: Bearer <access-token>` on versioned mobile routes.
- Revoke the current device independently; support a user-wide sign-out path.
- Keep the browser cookie path unchanged.
- Store native credentials in SecureStore, never AsyncStorage or app logs.
- Apply login, refresh, OTP, and reset rate limits per account, device, and IP.

Do not expose the existing 14-day browser session token in a general web login
response.

### 2. Stable versioned API facade

Add `/api/mobile/v1` handlers that call the existing server-side domain
functions. They should not duplicate trading rules.

Every response should provide a stable error code and request ID. Mobile
requests should send:

- `Authorization`
- `Accept-Language: ar` or `en`
- `X-App-Version`
- `X-Device-Id` containing a random installation ID, not a hardware identifier
- `Idempotency-Key` for trade-changing requests

Never authorize from role, user ID, locale, or device headers; resolve identity
and roles from the validated device session.

### 3. Mobile-safe evidence uploads

The current trade evidence route accepts base64 inside JSON. Before native trade
flows ship, add multipart upload or a short-lived signed direct-upload flow.

Requirements:

- Preserve participant/role checks before issuing or accepting an upload.
- Enforce byte size, allowed media type, and file signature server-side.
- Generate server-owned filenames and avoid contact data in object keys.
- Make finalization idempotent so retries cannot advance a trade twice.
- Return progress-safe errors and never include storage-provider details.

### 4. Push and foreground freshness

- Register push tokens per user, device, platform, locale, and app version.
- Require an authenticated device session to register or delete a token.
- Keep notification payloads privacy-safe: no bank details, phone numbers,
  evidence URLs, or sensitive message text on the lock screen.
- Deep-link to a route identifier and fetch authorized content after open.
- Use bounded foreground polling for the first beta where the web app currently
  relies on SSE. Push is a wake-up hint, never the source of truth.

### 5. Idempotency and reconciliation

All money/trade-changing operations must be safely retryable across weak mobile
networks. At minimum this covers purchase creation, state transitions, evidence
finalization, disputes, reviews, and commission submission.

The server remains authoritative. The app may optimistically update cosmetic UI,
but it must re-fetch the trade snapshot after every mutation and on foreground.
No trade transition should be queued for offline execution.

## Proposed repository layout

```text
apps/
  mobile/                 Expo app, Expo Router routes, native UI
packages/
  contracts/              API schemas, domain DTOs, stable error codes
  design-tokens/          colors, spacing, typography, semantic tokens
src/                      existing Next.js web and server application
```

Create the workspace only after the device-auth contract is reviewed, so the
first app slice can sign in against a real, secure API instead of temporary
mocks that later become production dependencies.

## Native MVP

### Phase 1: read-only private beta

- Arabic/English selection with complete RTL navigation.
- Login, registration handoff, verification state, logout, and session expiry.
- Marketplace browse/filter, listing details, seller profile, and reviews.
- Profile and notification center.
- Deep links from privacy-safe push notifications.

### Phase 2: trading

- Create and view purchase requests.
- Active trades and full trade-room state.
- Messages, buyer/seller evidence upload, confirmation steps, and disputes.
- Seller availability and listing management for approved sellers.

### Phase 3: academy and refinement

- Academy/lesson experience appropriate for native playback. Completed in
  source with published-only authenticated APIs, five-tab phone navigation,
  offline content caching, local progress, quizzes, bookmarks, and notes.
- Biometric re-entry as a local convenience, never as server authorization.
  Completed in source with optional per-account enrollment, immediate
  app-switcher masking, protected SecureStore sentinels, and safe recovery when
  biometric enrollment changes.
- Accessibility, degraded-network UX, and app update enforcement. Completed in
  source with screen-reader structure, explicit financial form labels, loading
  state announcements, scalable wrapping layouts, readable minimum type sizes,
  reduced-motion navigation, offline recovery, and mandatory-version handling.
- Store listing assets, signed-build acceptance, and release-console work.

Admin moderation, announcements, user-role changes, imports/exports, and Discord
operations remain on the web console until a separate security review approves
native administration.

## Screen and route map

```text
(public)
  language -> welcome -> login/register
  marketplace -> listing -> seller profile

(authenticated tabs)
  marketplace
  academy -> course -> lesson
  trades -> trade room -> evidence/dispute/review
  notifications
  profile -> settings/security/seller workspace

(approved seller)
  seller workspace -> listings/availability
```

## Client foundations

- Expo Router route groups for public, authenticated, buyer, and approved-seller
  screens.
- A single typed API client with request IDs, timeouts, cancellation, token
  refresh serialization, and one retry only for safe/idempotent requests.
- TanStack Query or an equivalent query cache for server state; no second copy
  of marketplace truth in a global client store.
- SecureStore for credentials and non-sensitive storage for locale/onboarding.
- Native deep-link allowlist; never open an arbitrary URL supplied by an API.
- Error reporting with contact-bearing and financial fields scrubbed before
  transmission.

## Environments and delivery

Use distinct development, preview, and production API origins. Production builds
must refuse cleartext HTTP and must not contain test-support secrets or admin
keys. Use EAS internal distribution for the first device beta, then TestFlight
and Google Play internal testing before public review.

## Release gates

The native beta is ready only when:

- Web production health is stable through cold starts.
- Device login, refresh rotation, revocation, and expiry tests pass.
- Cross-user authorization tests cover every private mobile endpoint.
- Duplicate/replayed trade mutations are harmless.
- Upload size/type/signature checks pass on iOS and Android fixtures.
- Arabic RTL and English layouts pass on small and large phones.
- Any build that enables remote push opens only the correct authorized
  destination and never includes sensitive preview data.
- Airplane-mode, timeout, app-kill, background/foreground, and expired-session
  recovery paths are verified.
- No admin-only capability or secret is bundled into the app.

## Current private-beta status

Completed in source:

- Versioned, device-bound access and rotating refresh sessions.
- Bilingual marketplace, seller profiles, buyer request creation, participant-
  only Trade Rooms, chat, bank-detail reveal, evidence upload, buyer disputes,
  verified post-trade reviews, and seller review responses.
- Privacy-safe native notification center with unread state, bounded polling,
  capped paginated history, and allowlisted deep links. Marketplace and trade
  collections use the same bounded incremental-loading contract.
- SecureStore session persistence, account-isolated query caches, foreground
  refresh, private-beta access/password-recovery handoffs, and legal/account-management
  links.
- Optional per-account Face ID/fingerprint privacy lock. It uses a separate
  authentication-protected sentinel, masks the navigation tree before app
  backgrounding, pauses live queries while locked, and requires a fresh sign-in
  after the operating system invalidates changed biometric enrollment.
- Native connectivity monitoring that pauses server-state fetches while offline,
  resumes and refreshes them after reconnection, and presents bilingual degraded-
  network status without discarding a saved session.
- Platform-specific minimum-version enforcement on every mobile API surface,
  plus a fail-open startup check and bilingual mandatory-update screen. A known
  mandatory update remains enforced during later network loss.
- Full bilingual native Academy with published-only authenticated catalog and
  lesson projections, absolute HTTPS media handoffs, account-isolated offline
  content/progress, course resume state, lesson requirements, quizzes,
  bookmarks, notes, and previous/next navigation. The tab bar stays at five
  destinations on small phones; approved sellers enter their native workspace
  from Profile.
- Native accessibility guardrails covering headings, form controls, busy states,
  44–52 point touch targets, larger base caption sizes, wrapping financial
  layouts, modal biometric masking, and operating-system reduced-motion settings.
- Role-gated approved-seller workspace with bounded private listing history,
  retry-safe pause/resume actions, availability controls, and a fixed trusted
  handoff for creation, financial edits, bank management, and commissions.
- Automated native type-check and iOS/Android export inside the repository
  release gate, plus pinned Expo Doctor validation for app configuration and
  duplicate native-module detection.

Still requires external acceptance:

- One signed Android internal build and the real-device matrix in the
  [private-beta release runbook](./private-beta-release-runbook.md).
- Apple Developer enrollment, signing, and one TestFlight build.
- Push-token registration and privacy-safe remote push delivery. The first
  private build continues to use bounded foreground polling until that path is
  implemented and verified on real devices.
- Store metadata, screenshots, reviewer access, and final release approval.

The exact handoff sequence, evidence to record, and card-gated steps are in the
[private-beta release runbook](./private-beta-release-runbook.md).

## First implementation slice

1. Extract versioned DTOs and stable error codes into `packages/contracts`.
2. Add device-session tables and hashed, rotating token services.
3. Implement the four `/api/mobile/v1/auth/*` endpoints with negative
   authorization tests.
4. Scaffold `apps/mobile` with locale selection, SecureStore-backed session
   handling, login, and a read-only marketplace.
5. Distribute an internal build to real iOS and Android devices before adding
   trade mutations.

That slice proves the security boundary, bilingual navigation, build pipeline,
and production API integration before the highest-risk trading features are
introduced.
