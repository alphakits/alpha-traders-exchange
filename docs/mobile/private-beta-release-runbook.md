# Native private-beta release runbook

This runbook separates source readiness from external account, signing, and
store-review work. Never put Expo, Apple, Google, Supabase, or production secrets
in source control, build logs, screenshots, or tester messages.

## 1. Source and backend gate

Run from the repository root on the exact commit intended for distribution:

```bash
npm ci
npm run verify:release:full
npm run mobile:verify
```

Record the commit SHA and retain the release-gate output. The production API at
`https://www.alphatraders.co.il` must be healthy before creating a signed build.
Do not copy production secrets or data into a preview environment.

## 2. Android internal build

After GitHub Actions billing is restored, dispatch **Mobile Preview** with
`platform=android`. The repository `EXPO_TOKEN` secret must already be present;
never print or copy it into an issue or chat. Record the EAS build URL, commit
SHA, profile (`preview`), and completion status.

Install the resulting internal APK only on named test devices. Do not upload it
to a public file host. A successful cloud build is not acceptance: complete the
device matrix in section 4.

## 3. iOS internal build

After Apple Developer Program enrollment and signing access are complete:

1. Register the intended test-device UDIDs for ad hoc distribution.
2. Dispatch **Mobile Preview** with `platform=ios`.
3. Confirm that EAS uses the expected bundle identifier
   `com.alphakits.alphatraders` and the `preview` profile.
4. Record the EAS build URL, commit SHA, signing team, registered devices, and
   completion status without recording private keys or credentials.

Use TestFlight for broader iOS beta distribution. Keep the first private build
on bounded foreground polling; remote push is a separate signed-device change
and must not contain trade amounts, bank details, wallet addresses, or evidence
in lock-screen text.

## 4. Real-device acceptance matrix

Run every critical path in both English and Arabic. Capture pass/fail, device,
OS version, build URL, and commit SHA; use fictional test identities and data.

| Area | Small phone | Large phone | Required evidence |
| --- | --- | --- | --- |
| Install and launch | iOS + Android | iOS + Android | Cold launch, icon, splash, no crash |
| Authentication | iOS + Android | iOS + Android | Login, invalid login, refresh, logout, reinstall |
| Recovery and legal | iOS + Android | iOS + Android | Password recovery, privacy, terms, support, account deletion |
| Marketplace | iOS + Android | iOS + Android | Refresh, pagination cap, seller profile, listing deep link |
| Buyer request | iOS + Android | iOS + Android | Buy now, price offer, validation, face-to-face acknowledgement |
| Seller workspace | iOS + Android | iOS + Android | Role gate, pagination, pause/resume retry, Available/Away/Vacation, trusted full-workspace handoff |
| Trade Room | iOS + Android | iOS + Android | Both roles, every state transition, chat, bank-detail gate |
| Evidence | iOS + Android | iOS + Android | Allowed image/PDF, oversize/type rejection, retry |
| Recovery | iOS + Android | iOS + Android | Offline, timeout, app kill, background/foreground, expired session |
| Accessibility | iOS + Android | iOS + Android | RTL order, text scaling, keyboard, screen-reader labels |
| Privacy | iOS + Android | iOS + Android | Account cache isolation and no sensitive lock-screen content |

Any reproducible failure blocks distribution. Fix it on a new commit, rerun the
source gate, rebuild, and repeat only the affected rows plus one full smoke pass.

## 5. Distribution decision

Internal testing and public store submission are separate approvals. Before any
public App Store or Google Play submission, the responsible business owner must
confirm the submitting legal entity, supported countries, and all licensing or
permissions required for a cryptocurrency marketplace. Do not claim that Alpha
Traders is licensed or approved unless current documentary evidence exists.

For review metadata:

- Use the production privacy, terms, support, and account-deletion URLs.
- Provide a fictional, fully functional reviewer account and exact review notes.
- Use screenshots from the submitted build; never show real user or trade data.
- Complete the store privacy/data-safety declarations from actual app behavior.
- Keep public beta language out of production metadata; iOS beta distribution
  belongs in TestFlight.

## 6. Release record

The release owner records:

- commit SHA and merged pull request;
- Vercel production deployment URL and health-check time;
- Android and iOS EAS build URLs and profiles;
- device-matrix result with any accepted limitations;
- store-console submission IDs when applicable;
- the person who gave final release approval and the approval time.

Never record passwords, session tokens, wallet secrets, signing keys, bank
details, payment evidence, or production-user information.
