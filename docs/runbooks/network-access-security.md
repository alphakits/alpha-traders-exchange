# Network access protection

## Behavior

`ALPHA_NETWORK_ACCESS_MODE` controls the server-side check in Next.js middleware:

| Mode | Provider lookup | Result |
| --- | --- | --- |
| `off` (default) | None | Existing access rules remain in effect. |
| `monitor` | Yes | Coarse verdicts are logged; requests continue through normal authentication. |
| `tor-only` | Yes | Explicit Tor: 403. Unverified Tor status: 503. Verified non-Tor connections, including other positive classifications, continue through normal authentication while those classifications are monitored. |
| `enforce` | Yes | Known VPN/proxy/Tor: 403. Unchecked connection: 503. Clear connection: continue through normal authentication. |

Select exactly one service with `ALPHA_NETWORK_ACCESS_PROVIDER`:

| Provider | Server-only secret | Classifications |
| --- | --- | --- |
| `proxycheck` (default) | `PROXYCHECK_API_KEY` | Explicit VPN, proxy and Tor flags from v3, pinned to `24-June-2026` |
| `ipregistry` | `IPREGISTRY_API_KEY` | Explicit VPN, proxy, Tor and private relay flags |

Only the selected service receives IP lookups. There is no automatic provider
fallback or trial-key sharing. Changing the provider or key invalidates cached
verdicts. Enabling checks without the selected key, or with an invalid mode or
provider, is a deployment validation error. No client cookie, role,
device header, user-agent, IP header from Cloudflare, or test flag disables the
network check. A network decision does not authorize account or trade access.

The gate covers matched application pages (including login and protected pages),
web APIs and native APIs. Static assets are outside this gate; it is not a content
DRM system. Existing downloaded pages, media and already-open streams cannot be
retroactively withdrawn. New server requests are re-evaluated for their current
IP. An IP change never inherits the previous address's verdict.

Detection uses explicit boolean classifications. A hosting classification, country, risk score or
unusual browser alone does not label a person a scammer. Missing fields, failed
lookups, quota exhaustion, and timeouts are unchecked, never clear.

Only the visitor IP is transmitted to the fixed HTTPS endpoint. No account name,
email, cookie, identity document, trade details or wallet information is sent.
Proxycheck positive-detection logging is disabled with `tag=0`. Ipregistry
receives its key in the Authorization header, never the URL; the response is
limited to the IP and four classification booleans. Its returned IP must match
the requested address after IPv6 normalization. Review each service's own
retention policy separately; `tag=0` does not apply to Ipregistry. Application logs
contain verdicts, mode and fixed positive classification labels (`vpn`, `proxy`,
`tor`, `private_relay`), without the IP, key or raw provider response. A
`network_provider_classification` event is recorded only after a validated
restricted lookup, so cached requests do not create extra provider calls or
repeat classification events. These labels explain the provider's decision;
they do not establish that a person intentionally installed a VPN. Per-instance memory
holds at most 2,048 verdicts, with 60-second expiry (5 seconds for failures), and
at most 128 concurrent lookups. Same-IP requests share an in-flight lookup.
Requests abort after 1.5 seconds. Deployment scaling may still multiply provider
usage; size the provider plan using observed traffic before enforcement.

Ipregistry responses also provide the remaining account credits. The middleware
records the numeric balance in `network_provider_capacity`, at most once every
five minutes per instance while its capacity band is unchanged. Crossing a band
is reported immediately: `low` at 2,000 credits or fewer, `critical` at 500 or
fewer, and `empty` at zero or HTTP 402. Low capacity is a warning; critical and
empty capacity are errors. Missing or malformed balance headers are ignored,
never interpreted as unlimited capacity. These events contain no IP, key,
lookup URL or provider body, and make no additional provider calls. They do not
change the network verdict, buy credits or automatically disable enforcement.
Inspect the latest balance alongside the provider dashboard; old samples are
not current capacity, and scaling can create more than one sampled event.
No external alert delivery is implied by writing a runtime log.

Vercel ingress headers are authoritative. Arbitrary `cf-connecting-ip` input is
ignored. Malformed IPs and comma-separated trusted headers produce an unchecked
result. Other production hosting requires a reviewed ingress implementation;
arbitrary forwarding headers there are not trusted.

Only exact, method-scoped health, all six configured cron routes, signed webhook
endpoints and session revocation methods are excluded from network classification.
Their existing authorization/signature checks are required. Web logout POST and
native session DELETE remain available during a connection block, without
granting account or trade access. Other methods on those paths are not exempt.
The WhatsApp webhook reaches its signature validator instead of being rejected
for a missing browser Origin header.

## Activation and verification

1. Complete the selected provider's account and email verification. Add the
   matching server-only credential and `ALPHA_NETWORK_ACCESS_PROVIDER` to
   Preview and Production through
   Vercel's secret configuration. Do not put it in a commit, browser variable,
   screenshot, support message or chat. Review the provider's IP processing and
   retention terms and the site's privacy notice before live checks. Trial
   credits are for initial validation; they are not unlimited production
   capacity. Confirm a sustainable quota and quota monitoring before enforcement.
2. Deploy with `monitor`. Confirm provider responses and plan capacity, IPv4 and
   IPv6, mobile carriers, iPhone Private Relay, and false positives. Confirm live
   signed callbacks and scheduled jobs still authenticate and complete.
3. Set only Preview to `enforce`. Test a direct connection and a known VPN on a
   real device. Repeat on Safari, Chrome and the signed iOS/Android app. A unit
   test with mocked classifications does not prove live detection coverage.
4. Confirm the direct connection can sign in, trade, and access support. The VPN
   must receive the 403 message on pages and APIs. Turning it off must recover;
   access errors must not delete a valid session. Provider failures must return
   503 with retry guidance, not a false VPN accusation or a silent allow.
5. After preview and monitor review, enable Production enforcement and redeploy.
   Monitor errors and latency. Use Vercel configuration to recover a false block
   or provider outage; application owner pages are subject to the same gate.
   Switching off restores pre-gate behavior and should be a deliberate operator
   decision, never an automatic or user-controlled bypass.

Enforced provider failures can temporarily make the interactive service
unavailable, including an active trade. This is the availability cost of refusing
unchecked connections. Do not enable until the provider and recovery procedure
are ready. Users of legitimate privacy tools may need to disable them too.

## False-positive recovery

If an ordinary user is blocked after activation, restore `monitor` through the
production environment and deploy or roll back to the known monitor-mode
deployment. Keep platform DDoS mitigation, WAF limits and authentication active.
Verify the public aliases and a live `mode=monitor` event; editing the project
environment alone does not change the running deployment.

Use `network_provider_classification` to distinguish the positive provider
flags. Normal Safari can use iCloud Private Relay without a VPN app. Do not
infer Private Relay from the browser alone or label every restricted connection
as a VPN. Correlate the reported attempt with the request timestamp and platform
request details; do not add raw IPs, credentials or provider bodies to logs.
The block page and API message must acknowledge possible misclassification.

The `tor-only` recovery mode can enforce an explicitly requested Tor block while
VPN, proxy and privacy-relay false positives are investigated. It is not full
VPN enforcement. A validated explicit false Tor flag is required to continue;
missing/malformed Tor status, mismatched IP, provider failure and quota
exhaustion return 503. Validate direct access and actual Tor denial before
publishing this mode. The same cache, trusted-ingress rules, authentication and
narrow machine-endpoint exceptions apply. Detection is based on the observed
network; the browser's name or user-agent never creates a block or exemption.

Keep enforcement in preview until representative physical-device acceptance
and the affected connection's recovery are recorded. Any proposal to permit
privacy relays is a separate policy decision; do not silently add a Safari,
owner-account, device-header or IP allowlist bypass to make a test pass.

## Identity and data safeguards

VPN detection is not identity verification and cannot detect every VPN or
residential relay. A direct connection does not establish a user's real identity
or intent. All production accounts require SMS phone verification;
seller identity review is a separate owner workflow. This change does not mark
anyone government-ID verified, collect new identity documents, or change who
may see private names, phone numbers, bank details, evidence or ATM credentials.

The existing role checks, participant checks, trade-stage disclosures, shared
rate limits, session revocation, signed callbacks and encryption remain needed.
Protection against all bugs, scams or attacks cannot be guaranteed. Public IPs,
AT IDs and account approvals should not be presented as such a guarantee.

## Sources

- https://vercel.com/docs/headers/request-headers
- https://proxycheck.io/api/
- https://ipregistry.co/docs/authentication
- https://ipregistry.co/docs/endpoints
- https://ipregistry.co/docs/filtering
- https://ipregistry.co/docs/proxy-tor-threat-detection
- https://vercel.com/docs/vercel-firewall
