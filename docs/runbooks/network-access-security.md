# Network access protection

## Behavior

`ALPHA_NETWORK_ACCESS_MODE` controls the server-side check in Next.js middleware:

| Mode | Provider lookup | Result |
| --- | --- | --- |
| `off` (default) | None | Existing access rules remain in effect. |
| `monitor` | Yes | Coarse verdicts are logged; requests continue through normal authentication. |
| `enforce` | Yes | Known VPN/proxy/Tor: 403. Unchecked connection: 503. Clear connection: continue through normal authentication. |

Set `PROXYCHECK_API_KEY` as a server-only secret. Enabling checks without it or
with an invalid mode is a deployment validation error. No client cookie, role,
device header, user-agent, IP header from Cloudflare, or test flag disables the
network check. A network decision does not authorize account or trade access.

The gate covers matched application pages (including login and protected pages),
web APIs and native APIs. Static assets are outside this gate; it is not a content
DRM system. Existing downloaded pages, media and already-open streams cannot be
retroactively withdrawn. New server requests are re-evaluated for their current
IP. An IP change never inherits the previous address's verdict.

Detection uses the explicit `vpn`, `proxy`, and `tor` booleans from proxycheck.io
v3, pinned to `24-June-2026`. A hosting classification, country, risk score or
unusual browser alone does not label a person a scammer. Missing fields, failed
lookups, quota exhaustion, and timeouts are unchecked, never clear.

Only the visitor IP is transmitted to the fixed HTTPS endpoint. No account name,
email, cookie, identity document, trade details or wallet information is sent.
Provider positive-detection logging is disabled with `tag=0`; application logs
contain only coarse verdicts and mode, without the IP or key. Per-instance memory
holds at most 2,048 verdicts, with 60-second expiry (5 seconds for failures), and
at most 128 concurrent lookups. Same-IP requests share an in-flight lookup.
Requests abort after 1.5 seconds. Deployment scaling may still multiply provider
usage; size the provider plan using observed traffic before enforcement.

Vercel ingress headers are authoritative. Arbitrary `cf-connecting-ip` input is
ignored. Malformed IPs and comma-separated trusted headers produce an unchecked
result. Other production hosting requires a reviewed ingress implementation;
arbitrary forwarding headers there are not trusted.

Only exact, method-scoped health, cron, and signed webhook endpoints are excluded
from network classification. Their existing authorization/signature checks are
required. The WhatsApp webhook now reaches its signature validator instead of
being rejected for a missing browser Origin header.

## Activation and verification

1. Add the server-only provider credential to Preview and Production through
   Vercel's secret configuration. Do not put it in a commit, browser variable,
   screenshot, support message or chat. Review the provider's IP processing and
   retention terms and the site's privacy notice before live checks.
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

## Identity and data safeguards

VPN detection is not identity verification and cannot detect every VPN or
residential relay. A direct connection does not establish a user's real identity
or intent. Buyers currently use verified email and a private contact number;
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
- https://vercel.com/docs/vercel-firewall
