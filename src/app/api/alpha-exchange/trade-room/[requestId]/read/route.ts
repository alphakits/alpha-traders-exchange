import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTradeRoomData } from "@/lib/alpha-exchange-store";
import { requireApiUser, requireEmailVerificationForTrading } from "@/lib/api-auth";
import { hasTrustedSameOrigin } from "@/lib/request-origin";
import { checkSharedRateLimit } from "@/lib/rate-limit";

const headers = { "Cache-Control": "private, no-store, max-age=0" };
const bodySchema = z.object({ messageIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)).min(1).max(100) }).strict();

export async function POST(request: NextRequest, context: { params: Promise<{ requestId: string }> }) {
  if (!hasTrustedSameOrigin(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403, headers });
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const verification = requireEmailVerificationForTrading(user);
  if (verification) return verification;
  let parsed: ReturnType<typeof bodySchema.safeParse>;
  try {
    const raw = await request.text();
    if (raw.length > 16_384) throw new Error("body_too_large");
    parsed = bodySchema.safeParse(JSON.parse(raw));
  } catch { return NextResponse.json({ error: "Invalid message IDs." }, { status: 400, headers }); }
  if (!parsed.success) return NextResponse.json({ error: "Invalid message IDs." }, { status: 400, headers });
  const limit = await checkSharedRateLimit({ headers: request.headers, key: "trade-chat-read", identifier: user.id, maxRequests: 120, windowMs: 60_000 });
  if (!limit.allowed) return NextResponse.json({ error: "Please retry shortly." }, { status: 429, headers });
  try {
    const { requestId } = await context.params;
    const room = await getTradeRoomData({ purchaseRequestId: requestId, actorUserId: user.id, actorRole: user.role, markMessagesRead: true, readMessageIds: parsed.data.messageIds, strongConsistency: true });
    if (room.request.buyerId !== user.id && room.request.sellerId !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers });
    const selected = new Set(parsed.data.messageIds);
    const messages = room.messages.filter(message => selected.has(message.id) && message.readByUserIds.includes(user.id))
      .map(({ id, readByUserIds, seenAt, deliveredAt }) => ({ id, readByUserIds, seenAt, deliveredAt }));
    return NextResponse.json({ messages }, { headers });
  } catch {
    return NextResponse.json({ error: "Read receipt unavailable." }, { status: 400, headers });
  }
}
