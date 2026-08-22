import { after, NextRequest, NextResponse } from "next/server";
import { postTradeRoomPoke, TradeRoomPokeError } from "@/lib/alpha-exchange-store";
import { requireApiUser, requireEmailVerificationForTrading } from "@/lib/api-auth";
import { prepareTradeRoomConversationEmail } from "@/lib/marketplace-email-events";
import { logEvent } from "@/lib/structured-logging";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const emailVerificationRequired = requireEmailVerificationForTrading(user);
  if (emailVerificationRequired) return emailVerificationRequired;

  try {
    const { requestId } = await context.params;
    const poked = await postTradeRoomPoke({
      purchaseRequestId: requestId,
      actorUserId: user.id,
      requestHeaders: request.headers,
    });

    // Poke persistence, in-app notification, and Trade Room SSE have already
    // committed. Resend work is deliberately post-commit so provider trouble
    // never removes an accepted reminder.
    try {
      const deliverEmail = await prepareTradeRoomConversationEmail({
        event: "trade_room_poke",
        request: poked.trade,
        recipientUserId: poked.notificationRecipientUserId,
        senderUserId: user.id,
        senderRole: poked.senderParticipantRole,
        idempotencyKey: `trade-room-poke:${poked.message.id}:${poked.notificationRecipientUserId}`,
      });
      after(deliverEmail);
    } catch (emailScheduleError) {
      logEvent("error", {
        event: "trade_room_email_schedule",
        actorUserId: user.id,
        resourceId: poked.trade.id,
        outcome: "failed",
        reason: "poke_post_commit_schedule_failed",
        metadata: { errorType: emailScheduleError instanceof Error ? emailScheduleError.name : typeof emailScheduleError },
      });
    }

    return NextResponse.json({ poke: poked.poke }, { status: 201 });
  } catch (error) {
    if (error instanceof TradeRoomPokeError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          cooldownUntil: error.cooldownUntil,
        },
        {
          status: error.status,
          headers: error.retryAfterSeconds
            ? { "Retry-After": String(error.retryAfterSeconds) }
            : undefined,
        },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send Trade Room reminder." },
      { status: 400 },
    );
  }
}
