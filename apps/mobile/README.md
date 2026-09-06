# Alpha Traders mobile

Expo/React Native client for iOS and Android. The existing Next.js application
remains the only business-logic backend.

## Private-beta capabilities

- Arabic/English onboarding, marketplace, seller profiles, and account access.
- Device-bound opaque access/refresh sessions stored with SecureStore.
- Buyer purchase requests and ILS price offers.
- Participant-only Trade Room lifecycle and bilingual in-room chat for buyers
  and sellers, with direct contact details blocked by the server.
- Protected bank-detail reveal after seller acceptance.
- Payment and USDT evidence uploads through the system photo picker. Images
  are resized and re-encoded before upload so embedded photo metadata is not
  retained.
- Owner and administrator operations remain web-only.

## Local start

```bash
npm install
npm run mobile:start
```

Set `EXPO_PUBLIC_API_URL` only when testing against a local or preview backend.
Release builds default to `https://www.alphatraders.co.il` and reject cleartext
HTTP origins.

## Security boundary

- Native access and refresh tokens are stored only with Expo SecureStore.
- Reinstall detection clears any iOS Keychain values left by an older install.
- Browser cookies are never read or written by the native API.
- Refresh calls are serialized and rotate both tokens.
- Mutations may only retry when they are idempotent.
- User IDs, roles, and locale headers never grant authorization.
- Native trade APIs require both a valid device session and canonical trade
  participation, including for owner or administrator accounts.
