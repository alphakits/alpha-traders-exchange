# Firewall burst monitors

Two log-only rate-limit rules are prepared in Vercel Firewall for the production
project. They are unpublished drafts and do not yet block or log live traffic.

| Rule | Scope | Threshold |
| --- | --- | --- |
| Alpha authentication burst monitor | POST web login/register/reset/email verification/buyer OTP onboarding; native login/refresh/web-session | 60 requests per 60 seconds per IP per region |
| Alpha marketplace read burst monitor | GET web exchange APIs and native marketplace/trades/notifications | 600 requests per 60 seconds per IP per region |

Both use fixed windows and a Log follow-up, with no browser challenges,
JA4 blocks, broad bypasses or persistent actions. Callback and cron paths are
outside these scopes. Shared cellular/Wi-Fi IPs can represent many real users;
review those cases before changing Log to 429.

The Vercel Firewall skill requires the project owner to publish:
Firewall → Rules → Review Changes → Publish. Then observe matching traffic,
test blocking in preview, and only then enforce the reviewed thresholds in
production. These drafts are monitoring preparation, not additional active
DDoS mitigation. Existing Vercel system DDoS mitigations remain enabled.

The dashboard displayed rate-limit pricing of $0.50 per million allowed
requests and no charge for blocked requests. Review current charges and
traffic before publishing. Counters are per region, not a global IP total.

VPN/provider activation is separate; see [network-access-security.md](network-access-security.md).
No firewall or IP detector guarantees prevention of every attack.

Reference: https://vercel.com/docs/vercel-firewall/vercel-waf/custom-rules
