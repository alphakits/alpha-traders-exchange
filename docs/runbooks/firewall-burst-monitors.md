# Firewall burst monitors

Two log-only rate-limit rules were published in Vercel Firewall for the
production project on 3 October 2026. The account's audit log showed version #1
with both rules created and enabled. They log matching bursts and do not block
requests. Recheck the current configuration before changing enforcement.

| Rule | Scope | Threshold |
| --- | --- | --- |
| Alpha authentication burst monitor | POST web login/register/reset/email verification/buyer OTP onboarding; native login/refresh/web-session | 60 requests per 60 seconds per IP per region |
| Alpha marketplace read burst monitor | GET web exchange APIs and native marketplace/trades/notifications | 600 requests per 60 seconds per IP per region |

Both use fixed windows and a Log follow-up, with no browser challenges,
JA4 blocks, broad bypasses or persistent actions. Callback and cron paths are
outside these scopes. Shared cellular/Wi-Fi IPs can represent many real users;
review those cases before changing Log to 429.

Observe matching traffic, test blocking in preview, and only then enforce the
reviewed thresholds in production. The Vercel Firewall skill requires the
project owner to publish future configuration changes:
Firewall → Rules → Review Changes → Publish. These log rules provide monitoring,
not additional blocking mitigation. Existing Vercel system DDoS mitigations
were enabled and no system bypass rules were present when inspected.

The dashboard displayed rate-limit pricing of $0.50 per million allowed
requests and no charge for blocked requests. Review current charges and
traffic before publishing. Counters are per region, not a global IP total.

VPN/provider activation is separate; see [network-access-security.md](network-access-security.md).
No firewall or IP detector guarantees prevention of every attack.

Reference: https://vercel.com/docs/vercel-firewall/vercel-waf/custom-rules
