# Native private-beta release runbook

This runbook separates source readiness from external account, signing, and
store-review work. Never put Expo, Apple, Google, Supabase, or production secrets
in source control, build logs, screenshots, or tester messages.

## 1. Source and backend gate

Run from the repository root on the exact commit intended for distribution:

```bash
npm ci
npm run mobile:review-rehearsal
npm run mobile:scale-rehearsal
npm run verify:release:full
npm run mobile:verify
```

The reviewer rehearsal is non-financial and isolated from production storage.
It exercises the full fictional buyer/seller lifecycle and safety paths using
only in-memory data; `verify:release:full` runs it again as a named blocking
step. The scale rehearsal completes ten isolated fictional trades concurrently,
including chat, evidence, settlement, listing reopening, commissions, and
reviews. Neither test is a production load test. A failure blocks the release
before deployment.

`mobile:verify` also checks the App Store metadata, opaque 1024 px icons,
transport security, full-app shipping shell, native push/review hooks, public
privacy/support/deletion/report routes, and submission documentation. The
manual public-submission confirmations are intentionally separate; see
`docs/mobile/app-store-connect-submission-pack.md` for iOS and
`docs/mobile/google-play-submission-pack.md` for Android.

`mobile:verify` includes Expo Doctor validation and must report every check as
passing. This blocks invalid app config and duplicate native-module versions
before either platform reaches EAS.

Record the commit SHA and retain the release-gate output. The production API at
`https://www.alphatraders.co.il` must be healthy before creating a signed build.
Do not copy production secrets or data into a preview environment.

Production App Review accounts are created only with the ordinary registration,
verification, seller-approval, listing, and owner-approval flows. Never expose
or use production-disabled setup/testing routes as a reviewer backdoor.

After the exact backend commit is deployed, run the credential-free public
review preflight and retain its timestamped output:

```bash
npm run mobile:review-surface
```

It verifies service/database health, the current iOS and Android version
contract, and the bilingual login, registration, support, privacy, terms,
account-deletion, abuse-reporting, help, and safety pages. It does not replace
the authenticated signed-device journey in
`docs/mobile/app-review-dry-run.md`.

### Minimum-version rollout safety

The production server reads these environment variables at runtime:

| Platform | Mandatory minimum | Latest recommended |
| --- | --- | --- |
| iOS | `MOBILE_MIN_IOS_VERSION` | `MOBILE_LATEST_IOS_VERSION` |
| Android | `MOBILE_MIN_ANDROID_VERSION` | `MOBILE_LATEST_ANDROID_VERSION` |

Use strict `major.minor.patch` values. Missing or malformed values safely fall
back to the source app version, and a configured latest version below the
minimum is raised to the minimum. The config endpoint remains available to an
old client, but every other mobile endpoint returns HTTP 426 with
`APP_UPDATE_REQUIRED` when the installed version is below the platform minimum.

Never raise a mandatory minimum until that exact version or a newer one is
signed, installable in the intended TestFlight/Google Play/internal channel,
and has passed the device matrix. Publish and verify the installable build
first, set the latest recommended version second, and raise the mandatory
minimum only after the release owner explicitly approves the cutoff. Until
signed distribution exists, keep both platform minimums at `1.0.0`.

Remote push uses Expo's push service. The signed app obtains its own Expo token;
the website stores it only after the canonical user session is authenticated.
If enhanced Expo push security is enabled for the EAS project, set the server-only
`EXPO_ACCESS_TOKEN` in Vercel. Never expose that value to the app or browser, and
never substitute the repository `EXPO_TOKEN`, which is only for EAS build access.

## 2. Android signed build and Play testing

After GitHub Actions billing is restored, dispatch **Mobile Preview** with
`platform=android`. The repository `EXPO_TOKEN` secret must already be present;
never print or copy it into an issue or chat. Record the EAS build URL, commit
SHA, profile (`preview`), and completion status.

Install the resulting internal APK only on named test devices. Do not upload it
to a public file host. A successful cloud build is not acceptance: complete the
device matrix in section 4.

For Play distribution, build the same approved commit with the EAS `production`
profile and confirm the output is a signed Android App Bundle for
`com.alphakits.alphatraders`. Keep the keystore and any Google service-account
credential in managed EAS/Google systems, never in the repository. Put the
bundle on the Play internal testing track first, record its EAS URL and Play
version code, and complete the Android device matrix plus Play pre-launch report.

Before moving to a closed/open/production track, complete the localized listing,
App access instructions, Data safety form, Financial features declaration,
content rating, target audience, account-deletion declaration, country/legal
matrix, and staged-rollout plan in
`docs/mobile/google-play-submission-pack.md`. Run
`npm run mobile:store-readiness:submission:android` only after the release owner
has confirmed those external steps.

## 3. iOS internal build

After Apple Developer Program enrollment and signing access are complete:

1. Confirm `release/iphone-installed-preview` points to the exact approved and
   fully gated `main` commit; an older release branch must not be built.
2. Push that exact release commit to trigger **Alpha Traders iPhone Installed
   Preview**, then complete its one-time device-registration request.
3. Confirm that EAS uses the expected bundle identifier
   `com.alphakits.alphatraders` and the `preview` profile.
4. Record the EAS build URL, commit SHA, signing team, registered devices, and
   completion status without recording private keys or credentials.

Use TestFlight for broader iOS beta distribution. The signed preview includes
remote push, while SSE and foreground refresh remain authoritative. Verify that
lock-screen copy contains no trade amounts, chat text, bank details, wallet
addresses, contact details, or evidence data.

## 4. Real-device acceptance matrix

Run every critical path in both English and Arabic. Capture pass/fail, device,
OS version, build URL, and commit SHA; use fictional test identities and data.

| Area | Small phone | Large phone | Required evidence |
| --- | --- | --- | --- |
| Install and launch | iOS + Android | iOS + Android | Cold launch, icon, splash, no crash |
| Authentication | iOS + Android | iOS + Android | Login, invalid login, refresh, logout, reinstall |
| App-switcher privacy | iOS + Android | iOS + Android | Trade/account content is covered before the app becomes inactive and restored only in the foreground |
| Profile | iOS + Android | iOS + Android | Activity cards, level progress, edit/cancel/save, every privacy switch, avatar fallback, account change |
| Recovery and legal | iOS + Android | iOS + Android | Password recovery, privacy, terms, support, account deletion |
| Marketplace | iOS + Android | iOS + Android | Refresh, filter/sort reset, filtered pagination, seller profile, listing deep link |
| Buyer request | iOS + Android | iOS + Android | Buy now, price offer, validation, face-to-face acknowledgement |
| Seller workspace | iOS + Android | iOS + Android | Role gate, pagination, pause/resume retry, Available/Away/Vacation, trusted full-workspace handoff |
| Trade Room | iOS + Android | iOS + Android | Both roles, every state transition, rapid competing-action taps, release timer/overdue state, chat, bank-detail gate, dispute eligibility, verified review, seller response |
| Notifications | iOS + Android | iOS + Android | Permission allow/deny/re-enable, background and terminated delivery, token rotation, unread badge, newest tap wins during cold-start races, ordinary relaunch does not reopen a consumed tap, Arabic/English privacy-safe preview |
| Evidence | iOS + Android | iOS + Android | Allowed image, oversize/type rejection, retry |
| Recovery | iOS + Android | iOS + Android | Offline, timeout, app kill, background/foreground, expired session |
| App version | iOS + Android | iOS + Android | Recommended version, HTTP 426, mandatory-update copy and support link |
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

Use `npm run mobile:store-readiness:submission:ios` for the Apple handoff,
`npm run mobile:store-readiness:submission:android` for the Google Play handoff,
or the combined `npm run mobile:store-readiness:submission` only when both
platforms are ready from the same exact release commit.

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
