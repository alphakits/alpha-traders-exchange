import { NextRequest, NextResponse } from "next/server";
import {
  parseWhatsAppWebhook,
  verifyWhatsAppWebhookChallenge,
  verifyWhatsAppWebhookSignature,
} from "@/lib/whatsapp-platform";
import {
  applyWhatsAppWebhookStatuses,
  revokeWhatsAppConsentByPhone,
} from "@/lib/whatsapp-notifications";
import { logEvent } from "@/lib/structured-logging";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const MAX_WEBHOOK_BODY_BYTES = 1_000_000;

export async function GET(request: NextRequest) {
  const challenge = verifyWhatsAppWebhookChallenge({
    mode: request.nextUrl.searchParams.get("hub.mode"),
    verifyToken: request.nextUrl.searchParams.get("hub.verify_token"),
    challenge: request.nextUrl.searchParams.get("hub.challenge"),
  });
  if (!challenge) return new NextResponse(null, { status: 403 });
  return new NextResponse(challenge, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

export async function POST(request: NextRequest) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BODY_BYTES) {
    return new NextResponse(null, { status: 413 });
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BODY_BYTES) {
    return new NextResponse(null, { status: 413 });
  }
  if (!verifyWhatsAppWebhookSignature({
    rawBody,
    signature: request.headers.get("x-hub-signature-256"),
  })) {
    return new NextResponse(null, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  try {
    const parsed = parseWhatsAppWebhook(payload);
    const statusUpdates = await applyWhatsAppWebhookStatuses(parsed.deliveryStatuses);
    let revokedSubscriptions = 0;
    // The provider parser emits only recognized STOP/opt-out commands. Other
    // inbound content is deliberately ignored and never becomes Trade Room chat.
    for (const optOut of parsed.optOuts) {
      revokedSubscriptions += await revokeWhatsAppConsentByPhone({
        phone: optOut.senderPhone,
        messageId: optOut.messageId,
        occurredAt: optOut.occurredAt,
      });
    }
    logEvent("info", {
      event: "whatsapp_webhook",
      outcome: "success",
      metadata: {
        statusUpdates,
        optOutCommands: parsed.optOuts.length,
        revokedSubscriptions,
      },
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    logEvent("error", {
      event: "whatsapp_webhook",
      outcome: "failed",
      reason: error instanceof Error ? error.message : "WhatsApp webhook processing failed.",
    });
    return NextResponse.json(
      { error: "Webhook processing failed." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
