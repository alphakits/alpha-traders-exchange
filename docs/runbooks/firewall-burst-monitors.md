# Firewall burst protection

Two rate-limit rules were first published in Log mode on 3 October 2026.
On 6 October, the preceding three days showed no matching bursts. Both rules
were then tested against a dedicated preview hostname at a temporary limit of
5 requests per minute: each bounded seven-request test returned five normal
application responses and two firewall HTTP 429 responses. The reviewed
production limits below were restored before removing the preview conditions
and publishing HTTP 429 enforcement. Recheck the live configuration before
changing thresholds or scope.

| Rule | Scope | Threshold |
| --- | --- | --- |
| Alpha authentication burst protection | POST web login/register/reset/email verification/buyer OTP onboarding; native login/refresh/web-session | 60 requests per 60 seconds per IP per region |
| Alpha marketplace read burst protection | GET web exchange APIs and native marketplace/trades/notifications | 600 requests per 60 seconds per IP per region |

Both use fixed windows and a Too Many Requests (429) follow-up, with no browser challenges,
JA4 blocks, broad bypasses or persistent actions. Callback and cron paths are
outside these scopes. Shared cellular/Wi-Fi IPs can represent many real users;
review those cases before lowering these limits. The counters are regional;
fixed-window boundaries can allow bursts across adjacent windows.

Observe matching traffic, test changes on a dedicated preview, and only then
publish reviewed production settings with the owner's authorization through
Firewall → Rules → Review Changes → Publish. Verify the published audit entry
and normal application requests. Existing Vercel system DDoS mitigations were
enabled and no system bypass rules were present when inspected. These two
rules cover the listed paths, not every route or every kind of attack.

The dashboard displayed rate-limit pricing of $0.50 per million allowed
requests and no charge for blocked requests. Review current charges and
traffic before publishing. Counters are per region, not a global IP total.

VPN/provider activation is separate; see [network-access-security.md](network-access-security.md).
No firewall or IP detector guarantees prevention of every attack.

Reference: https://vercel.com/docs/vercel-firewall/vercel-waf/custom-rules
