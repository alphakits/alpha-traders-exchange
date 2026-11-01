# Public discovery navigation acceptance

This batch adds visible, localized breadcrumbs to the existing Start, free-course and USDT/ILS guide pages. The component receives the same server-owned BreadcrumbList items that are serialized as structured data. Ancestors link to their canonical URLs; the current page is labeled with aria-current, not a redundant self-link. Arabic direction and the navigation label are explicit, and the trail wraps with keyboard-focus and touch-target styling. No new client effects, analytics events or API requests are added by the component.

The Start page leaves the brand suffix to the existing root metadata template instead of repeating the full brand twice. The AI-discovery directory lists direct canonical public pages, with the account-required marketplace entry separately labeled. Existing /usdt-ils and /p2p-usdt-israel redirect implementations, sitemap entries, robots policy and access enforcement remain unchanged.

## Release checks

The existing test:seo-discovery build gate includes visible/schema trail parity in both languages, ancestor URL membership in the public sitemap, existing legacy redirect destinations, an empty-trail case, the Start title contract and canonical AI-directory separation. Existing discovery metadata, FAQ, JSON-LD, login-handoff and all owner-analytics checks remain in the build chain. Fixture tests are not browser, physical-device or search-index evidence.

Inspect the exact branch-to-main diff and exact-head Vercel build before merging. Confirm the resulting production SHA and official aliases afterward. Check custom-domain HTTPS separately, without a Vercel share/authentication URL. A DNS-restricted verification runtime does not establish that the public site is down. Preview-host indexing headers must not be treated as custom-domain indexing evidence.

No Academy lesson, progress, login, verified-email, owner permission, seller approval, Exchange engine, trade-room, payment, commission, wallet or database implementation is changed. Keep unresolved installed-device and signed-in metric-reconciliation acceptance separate from this public-navigation release.
