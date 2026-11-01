import { NextRequest, NextResponse } from "next/server";
import { validateTwilioSignature } from "@/lib/notification-platform";
import { getSiteUrl } from "@/lib/site-url";
import { getTwilioWhatsAppSender } from "@/lib/twilio-whatsapp";
import { isWhatsAppOptOutText, normalizeWhatsAppE164, type WhatsAppDeliveryStatus } from "@/lib/whatsapp-platform";
import { applyWhatsAppWebhookStatuses, revokeWhatsAppConsentByPhone } from "@/lib/whatsapp-notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 100_000;

export async function POST(request: NextRequest) {
  if (process.env.ALPHA_EXCHANGE_WHATSAPP_PROVIDER?.trim().toLowerCase() !== "twilio") return new NextResponse(null, { status: 404 });
  if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) return new NextResponse(null, { status: 400 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 });
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 });
  const params = Object.fromEntries(new URLSearchParams(raw));
  const url = new URL("/api/twilio/whatsapp/webhook", getSiteUrl()).toString();
  if (!validateTwilioSignature({ signature: request.headers.get("x-twilio-signature"), url, params }) || params.AccountSid !== process.env.TWILIO_ACCOUNT_SID?.trim()) return new NextResponse(null, { status: 403 });
  if (!/^SM[0-9a-f]{32}$/i.test(params.MessageSid ?? "")) return new NextResponse(null, { status: 400 });
  try {
    const state = params.MessageStatus ?? params.SmsStatus;
    const status = ["failed", "undelivered", "canceled"].includes(state) ? "failed" : state;
    if (["sent", "delivered", "read", "failed"].includes(status)) {
      await applyWhatsAppWebhookStatuses([{ messageId: params.MessageSid, status: status as WhatsAppDeliveryStatus, occurredAt: new Date().toISOString(), failureCode: /^\d{1,6}$/.test(params.ErrorCode ?? "") ? params.ErrorCode : undefined }]);
    }
    if (params.From?.startsWith("whatsapp:") && params.To?.startsWith("whatsapp:") && isWhatsAppOptOutText(params.Body ?? "")) {
      const phone = normalizeWhatsAppE164(params.From.slice(9));
      if (!phone || normalizeWhatsAppE164(params.To.slice(9)) !== getTwilioWhatsAppSender()) return new NextResponse(null, { status: 400 });
      await revokeWhatsAppConsentByPhone({ phone, messageId: params.MessageSid, occurredAt: new Date().toISOString() });
      return new NextResponse("<Response />", { headers: { "Content-Type": "text/xml", "Cache-Control": "no-store" } });
    }
    return new NextResponse(null, { status: 204 });
  } catch {
    return new NextResponse(null, { status: 500 });
  }
}
