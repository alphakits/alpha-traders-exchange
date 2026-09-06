# Alpha Traders mobile

Expo/React Native client for iOS and Android. The existing Next.js application
remains the only business-logic backend.

## Private-beta capabilities

- Arabic/English onboarding, server-paginated marketplace with compact
  network/currency/payment/online filters and trusted seller sorting, seller
  profiles, and account access.
- Full native Academy navigation with published-only tracks and lessons,
  bilingual/RTL course content, quizzes, bookmarks, account-scoped progress,
  personal on-device notes, and offline access to previously loaded material.
- Trusted website handoffs for private-beta access, password recovery, account
  management/deletion, privacy, terms, and support.
- Device-bound opaque access/refresh sessions stored with SecureStore.
- Optional Face ID or secure-fingerprint privacy lock that masks authenticated
  content immediately in the app switcher and pauses live query work while
  locked. It protects local presentation only and never replaces server auth.
- Native screen-reader headings and form labels, 44–52 point touch targets,
  readable minimum text sizes, scalable/wrapping financial layouts, and device
  reduced-motion support for navigation transitions.
- Buyer purchase requests and ILS price offers.
- Network-specific receiving-wallet validation for TRC20, ERC20, BEP20, and
  Solana uses the same portable checksum/format rules as the server.
- Visible USDT release deadlines with warning/overdue states, backed by the
  canonical server timer rather than a client-authored deadline.
- Native notification center with unread badges, localized account updates,
  allowlisted Trade Room deep links, and bounded incremental history loading.
- Participant-only Trade Room lifecycle and bilingual in-room chat for buyers
  and sellers, with direct contact details blocked by the server. Eligible
  buyers can open disputes, buyers can leave verified post-trade reviews, and
  sellers can publish one response without exposing private record identifiers.
- Protected bank-detail reveal after seller acceptance.
- Payment and USDT evidence uploads through the system photo picker. Images
  are resized and re-encoded before upload so embedded photo metadata is not
  retained, then sent as bounded multipart files without base64 duplication in
  the app's JavaScript memory.
- Approved-seller workspace with private listing history, idempotent
  pause/resume controls, and Available/Away/Vacation switching. Listing
  creation, price/amount edits, bank management, and commission settlement use
  the fixed production seller-workspace handoff for this private beta.
- Owner and administrator operations remain web-only.

## Local start

```bash
npm install
npm run mobile:start
```

Validate both native bundles from the repository root before requesting an EAS
build:

```bash
npm run mobile:verify
```

Set `EXPO_PUBLIC_API_URL` only when testing against a local or preview backend.
Release builds default to `https://www.alphatraders.co.il` and reject cleartext
HTTP origins.

## Security boundary

- Native access and refresh tokens are stored only with Expo SecureStore.
- Reinstall detection clears any iOS Keychain values left by an older install.
- Browser cookies are never read or written by the native API.
- Biometric re-entry protects a separate opaque per-account sentinel; session
  tokens retain their independent rotation, revocation, and expiry lifecycle.
- Refresh calls are serialized and rotate both tokens.
- Slower requests reuse credentials already rotated by another request and
  cannot revive or clear a signed-out or replacement account session.
- Authenticated query caches are isolated by account and purged whenever the
  signed-in identity changes on a shared device.
- Academy response caches and learning progress use account-scoped device keys;
  authorization or version failures never fall back to locally cached content.
- Academy media handoffs accept absolute HTTPS URLs only. Draft content and
  storage-provider identifiers are not exposed by the catalog API.
- Foreground recovery immediately revalidates live queries after the app
  returns from the background.
- Mutations may only retry when they are idempotent.
- User IDs, roles, and locale headers never grant authorization.
- Native trade APIs require both a valid device session and canonical trade
  participation, including for owner or administrator accounts.
- Authenticated marketplace, seller-profile, and direct-listing views disable
  self-trade actions consistently and purge their personalized cache on account
  changes.
