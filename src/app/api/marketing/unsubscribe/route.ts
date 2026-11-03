import { NextRequest, NextResponse } from "next/server";
import { getMarketingUnsubscribeStatus, unsubscribeMarketingEmail } from "@/lib/marketing-email-ledger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

function tokenFrom(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

function page(state: "confirm" | "done" | "invalid" | "unavailable", token?: string) {
  const copy = {
    confirm: ["إلغاء رسائل المنتورشيب", "Stop mentorship emails", "إذا بدّك توقف هالرسائل، أكّد اختيارك تحت. حسابك ورسائل الأمان ما بتتغيّر.", "Confirm below to stop promotional invitations. Your account and security emails are unaffected."],
    done: ["تم إلغاء الاشتراك", "You’re unsubscribed", "تم تسجيل اختيارك. ما رح نبعتلك دعوات تسويقية من هالنظام. رسالة انبعتت قبل الإلغاء ممكن تكون بعدها بالطريق.", "Your choice is recorded. This system will not send you further promotional invitations. An email already sent before this change may still arrive."],
    invalid: ["الرابط مش متاح", "This link is unavailable", "افتح رابط إلغاء الاشتراك من الرسالة الأصلية.", "Please open the unsubscribe link from the original email."],
    unavailable: ["ما قدرنا نأكّد الإلغاء", "We could not confirm the change", "جرّب كمان مرة بعد شوي. ما رح نقول إنّه تم الإلغاء قبل ما ينحفظ اختيارك.", "Please try again shortly. We have not confirmed your unsubscribe because the change could not be saved."],
  }[state];
  // Tokens are validated before interpolation; this page contains no user data,
  // third-party assets, analytics, or links that could receive the capability.
  const form = state === "confirm" && token ? `<form method="post" action="/api/marketing/unsubscribe?token=${token}"><input type="hidden" name="confirm" value="1"><button type="submit">إلغاء الاشتراك · Unsubscribe</button></form>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Alpha Traders — Email preferences</title><style>body{margin:0;background:#111310;color:#f5f1e7;font:16px/1.7 Arial,Tahoma,sans-serif;display:grid;min-height:100vh;place-items:center}main{box-sizing:border-box;max-width:560px;padding:36px 24px;width:100%}header{color:#e7c476;letter-spacing:.08em}h1,h2{line-height:1.3}h2{font-size:22px}p{color:#d1cdbf}button{padding:14px 22px;background:#edc879;border:0;border-radius:8px;color:#211b10;font:600 16px Arial;cursor:pointer}button:focus-visible{outline:3px solid white;outline-offset:4px}form{margin-top:28px}</style></head><body><main><header>ALPHA TRADERS</header><section lang="ar" dir="rtl"><h1>${copy[0]}</h1><p>${copy[2]}</p></section><section><h2>${copy[1]}</h2><p>${copy[3]}</p></section>${form}</main></body></html>`;
}

function html(state: Parameters<typeof page>[0], status: number, token?: string) {
  return new NextResponse(page(state, token), { status, headers: { ...HEADERS, "Content-Type": "text/html; charset=utf-8" } });
}

/** Safe for link scanners: GET only displays the confirmation page. */
export async function GET(request: NextRequest) {
  const token = tokenFrom(request);
  if (!token) return html("invalid", 404);
  try {
    const result = await getMarketingUnsubscribeStatus(token);
    return result.valid ? html(result.unsubscribed ? "done" : "confirm", 200, token) : html("invalid", 404);
  } catch { return html("unavailable", 503); }
}

/** Supports both the human form and RFC 8058 one-click POST. */
export async function POST(request: NextRequest) {
  const token = tokenFrom(request);
  if (!token) return html("invalid", 404);
  try {
    const raw = await request.text();
    if (raw.length > 512) return html("invalid", 400);
    const body = new URLSearchParams(raw);
    const oneClick = body.get("List-Unsubscribe") === "One-Click";
    if (!oneClick && body.get("confirm") !== "1") return html("invalid", 400);
    const result = await unsubscribeMarketingEmail(token);
    if (!result) return html("invalid", 404);
    return oneClick
      ? new NextResponse("Unsubscribed", { status: 200, headers: { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" } })
      : html("done", 200);
  } catch { return html("unavailable", 503); }
}
