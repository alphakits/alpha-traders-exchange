# Expo SDK 57 replacement candidate verification

Verification completed on 20 September 2026 UTC.

This record covers the dependency correction and the new iOS candidate following
the earlier browser audit. It is technical release evidence, not an App Review
approval or a physical-device test result.

## Candidate identity

| Item | Verified value |
| --- | --- |
| Published application commit | `1d7bbc14499ae00de62952f2276c91461c427169` |
| Tested local commit | `290bbec3ef0c91ada22d53c082eb04c35e8f7670` |
| Complete, identical Git tree | `3d1f4f092f4617578d38db2351e66a9be0347785` |
| Local production web build | `A2FPdF5nYF-28xp6voRBM` |
| Signed iOS version / build | `1.2.0 (13)` |
| EAS build | `36a5130f-53ff-428c-95cc-9ff9c4836fe3` |
| Native fingerprint | `8fe8d19d88b541dc5419a3afad80afe56b64923e` |

The authenticated GitHub integration assigned new commit metadata. All four
uploaded blobs and the complete tree matched the local Git objects. The original
owner-approved `84df96d` contents remain in the ancestry through the identical-tree
published commit `87c6c93`.

The change updates 16 Expo SDK 57 dependencies to the recommended patch versions,
refreshes the lockfile, and updates two dependency-version assertions. It retains
React Native 0.86.3 and React 19.2.3.

## Validation

| Check | Result |
| --- | --- |
| Unit/integration suite | **1,893 passed**, 293 files |
| Full Exchange review rehearsal | **3 passed** |
| Ten-trade concurrency rehearsal | **3 passed** |
| Repository lint | Passed |
| Web and native TypeScript | Passed |
| Expo Doctor locally | **21/21 passed** |
| Expo Doctor on the signed EAS build | **21/21 passed**, no issues detected |
| Mobile store source readiness | **238 checks passed** |
| Native JavaScript exports | iOS and Android passed |
| Production web build | Passed |
| Complete Chromium suite | **148/148 passed**, zero retries, failures, skips, or flaky results |

The browser suite began at `2026-09-19T23:52:05.402Z` and took 281.201 seconds.
Its [sanitized per-test results](2026-09-19-sdk57-candidate-browser-results.json)
record one passing attempt for every test. The earlier Arabic 360px navigation
timeout did not recur; that case passed in this complete run. This does not
retroactively change the earlier [147/148 result](2026-09-19-browser-release-verification.md).

Checks were completed across successive commands. The combined release command
passed its tests, rehearsals, lint, type checks, Doctor, and source-readiness steps,
then encountered this environment's Google Fonts network restriction during the
web build. The build was completed using the genuine cached Inter and IBM Plex
Sans Arabic CSS/font assets from an earlier successful build. All 19 emitted font
files matched the cached originals by SHA-256, with the original weights and
Latin preload preserved. No application styling or production configuration was
changed for this adaptation.

The Chromium server used production mode, loopback-only test support, fictional
accounts, and the in-memory repository. These checks do not establish production
PostgreSQL behavior, real email/native push delivery, or physical-iPhone behavior.

## Deployment and binary delivery

- The [Vercel preview](https://vercel.com/alpha-kits/alpha-traders-exchange/hUmPVRrVR1QkfSG1N2eqbeiN3WjA)
  for the published commit is **Ready**. English, Arabic, privacy, and account
  deletion pages returned HTTP 200. Protected Exchange redirected to login with
  its return destination intact.
- [EAS build 13](https://expo.dev/accounts/alpha-traders/projects/alpha-traders/builds/36a5130f-53ff-428c-95cc-9ff9c4836fe3)
  **succeeded** in 4m 14s build time, 4m 43s total, using the production profile
  and production environment. It replaces build 12 as the native candidate.
- [Automatic TestFlight upload](https://expo.dev/accounts/alpha-traders/projects/alpha-traders/submissions/2b7df71e-0260-428e-b415-1f48e306265e)
  **succeeded**. App Store Connect independently lists
  [build 13](https://appstoreconnect.apple.com/teams/8ebe5146-261a-42f7-8fb2-f7ce8f5dbbcc/apps/6812101323/testflight/ios/1eaed895-a64e-4c0a-94b3-5ccde1b4f6e8)
  as **Ready to Submit**, with the **Alpha Traders Internal** group attached.
  This is TestFlight delivery; installation, on-device validation, and App Review
  acceptance are not claimed. Apple access was restored after its browser
  session expired during processing.
- The iOS 1.2.0 App Store draft now selects **build 13**. The selection was saved
  and independently verified after reloading. No **Update Review** or final
  resubmission action was invoked; the earlier rejection remains unresolved.
- [Hosted reliability run 35477259452](https://github.com/alphakits/alpha-traders-exchange/actions/runs/35477259452)
  completed with zero unit/build job steps executed and the browser job skipped.
  The earlier run's explicit account-billing lock remains recorded in the PR.
  The local passing results are not represented as passing hosted CI.

The native app still points to the existing production backend. Uploading the
binary does not deploy this PR's web/backend changes. No paid upgrade, production
merge, or App Review reply/resubmission was performed.

## Recording and remaining cutover work

The internal browser QA recording **passed** the existing guided cash-flow test
with fictional fixtures. It shows seller acceptance, buyer cash confirmation,
seller receipt confirmation, delayed wallet visibility, seller-only completion,
and the buyer's review destination. No real payment, identity review, or native
push delivery occurred.

The downloadable `Alpha-Traders-Browser-QA-1d7bbc1.mp4` is 26.920 seconds, H.264,
780 x 1820, and 4,733,685 bytes. Its SHA-256 is
`de399eabba66c62c92617a7d13fdcb4dbc5f3728f1b753fc5444457aecf4af69`.
It preserves the complete capture at half speed and adds a persistent label
identifying the synthetic data, source commit, Chromium viewport, and lack of a
physical iPhone. Representative frames were visually inspected. This is internal
QA evidence, not Apple's requested physical-device recording.

The recording setup initially lacked Playwright's video encoder; an attempted
installer also removed the cached Chromium executable. Neither failed attempt
entered the application test. The same cached Chromium archive used for the
148-test run was restored, the installed system FFmpeg was configured, and the
recorded test then passed in 13.2 seconds. No application changes or weakened
assertions were needed.

Live App Store Connect inspection confirmed one available storefront, **Israel**,
and six existing 6.5-inch iPhone screenshots. Screenshot correspondence to the
new signed candidate still requires checking. The review username field was
blank; a working pair of dedicated reviewer accounts has not been established.
Existing Review Notes reference earlier access instructions and must be replaced
with the verified fixture details before resubmission. Saving the new build
selection did not validate or update those instructions.

The currently deployed owner interface contains approved seller applications
but does not expose the new server-owned verification attestations. Before
production cutover, an authorized reviewer must reconcile the actual prior
identity-document, live-video, contact-ownership, and marketplace-rules checks.
Do not infer completed verification from an old approval status or bulk-create
attestations. Deploying first could remove legitimate sellers' access.

The remaining external work is to reconcile those seller records, deploy and
validate the matching backend, prepare and test dedicated non-financial reviewer
fixtures, record the signed build on a physical iPhone, and complete the exact
submitting-entity, Israel permission, and content-rights evidence requested by
Apple. The [controlled response package](../mobile/app-review-information-request-2026-09-19.md)
retains its unresolved placeholders until that evidence exists.
