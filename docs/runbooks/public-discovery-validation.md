# Public discovery validation

This batch adds a focused build gate for English/Arabic public discovery without modifying account access, authentication, seller approval or financial workflows.

- The private-route list is shared between existing robots exclusions and supplemental page-level noindex metadata. The serialized crawler allow/disallow scope is unchanged.
- Public metadata remains unchanged apart from correcting the English founder description, which previously used Arabic text.
- The fixture suite executes real metadata and discovery-page modules with small UI dependencies. It checks canonical and alternate URLs, social URL alignment, heading count, JSON-LD breadcrumbs, FAQ text parity, sitemap boundaries and the existing sign-in/Exchange links.
- `npm run build` now runs `test:seo-discovery` before the existing owner-analytics gate and compiler. A failed check stops the build. No new dependency is added.

These checks are not a real browser, installed app, authenticated trade-flow or Search Console test. Metadata and robots rules are not access controls. A crawler blocked by robots cannot fetch the page to see its noindex tag; existing account controls remain the primary protection for private content. Do not promise deindexing from these directives alone or weaken authentication to expose private content.

Reference: https://developers.google.com/search/docs/crawling-indexing/block-indexing
Reference: https://developers.google.com/search/docs/specialty/international/localized-versions

Direct custom-domain network verification, rendered-device acceptance and search-engine indexing outcomes must be reported separately from a successful Vercel deployment or fixture run. Keep private analytics counts and user details out of public repository evidence.
