# Platform simplification — review only

Owner requested an easier buyer/seller experience across the website and app, with exact changes and a preview before production. This branch is for review. Do not merge or promote it until Mark approves the review.

## What changes

| Area | Review version |
| --- | --- |
| Create listing | Three steps: Amount, Payment, Review. Required fields gate each step; Back preserves values. ILS appears in the price label instead of a redundant read-only currency field. |
| Listing completion | Clear pending-approval confirmation, Manage Listings action, and Create another listing when allowed. |
| Manage listings | Explicit Manage/Close labels and larger edit, pause, renew, delete and duplicate controls. |
| Commission | Amount due first, network and amount, then one payment-instructions action. Exact address, full amount, network-fee warning and do-not-resend warning remain visible. Technical matching details and the optional rounded amount are disclosures. |
| Buy USDT | One Start Trade submit action replaces two buttons that submitted the same request. Shorter fee, wallet and cardless guidance. Amount mismatch and safety guards remain. |
| Trade room | Shorter next-action, fee, cancellation, dispute and completion instructions. Monetary values and confirmation actions remain explicit. |
| Account and navigation | Less introductory text in login, registration, verification, onboarding and workspace cards; plain-language phone guidance. |
| Notifications and help | Long non-action updates open on demand. Action and commission alerts stay visible. Help begins with four task links; full guides and FAQs open on demand. |
| Public pages and learning | Shorter home, support, contact and learning-next-step copy. Full lessons and legal policies remain available. |
| App and Arabic | Paired Arabic/English copy, RTL review, and matching retained mobile copy. The current app uses the website shell, so the web interface applies there too. |
| Visual polish | Short step transitions, a moving progress line, completed-step checkmarks, task icons, responsive task cards, expanding help, and a small celebration after a listing is submitted. These are source changes, respect reduced-motion settings, and add no animation dependency. |

## Preserved behavior

Pricing, fee calculations and live values remain dynamic. The new-policy split is 1% buyer plus 1% seller, with the seller responsible for settling both shares in USDT. Legacy fee calculations, seller approval, bank requirements, active-listing and commission blocks, privacy/AT IDs, account verification, cancellation locks and owner powers are unchanged.

The UI changes are implemented in the source. No injected styles, browser-only override or production data mutation is required.

## Review evidence

The accompanying visual review contains real local browser screenshots with synthetic accounts. Listing and purchase flows use the actual local API and repository; payment-display states are explicitly simulated and do not represent a real payment or blockchain settlement.

`scripts/ux-review-capture.ts` refuses non-loopback fixture targets. Run it against a local test-support server with an isolated in-memory repository. It checks required fields, navigation, consent, exact saved data, English/Arabic screens and overflow at 320, 390 and 1440 pixels. The `buyer` argument captures the buyer request and trade-room journey. Optional `REVIEW_CHROMIUM_PATH`, `REVIEW_CHROMIUM_ARGS` and `REVIEW_OUTPUT_DIR` select a local browser/runtime and output folder.

A native device, real commission transfer, external notification delivery and production deployment are separate release checks; local screenshots and mocks do not prove those services. The repository's release safety gate and protected CI must pass before a separately approved live release.

The expanded visual album compares the original source at `4271617` with this review branch at matching phone widths and fixture values. It includes Arabic and English. Conditional component examples and simulated payment/announcement states are labeled; the motion preview is a recording of the actual local interface. Temporary capture routes and synthetic account credentials are excluded from the review branch.
