import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { deliverAdminAnnouncementBatch } from "@/lib/alpha-exchange-store";
import { checkRateLimit, createRateLimitResponse } from "@/lib/rate-limit";

type RouteContext = {
  params: Promise<{ announcementId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;
  const limit = checkRateLimit({
    headers: request.headers,
    key: "admin-announcement-deliver",
    identifier: user.id,
    maxRequests: 240,
    windowMs: 60 * 60_000,
  });
  if (!limit.allowed) return createRateLimitResponse(limit.retryAfterSeconds);

  try {
    const { announcementId } = await context.params;
    const run = await deliverAdminAnnouncementBatch({
      adminUserId: user.id,
      announcementId,
    });
    return NextResponse.json({
      run: {
        id: run.id,
        status: run.status,
        recipientCount: run.recipientCount,
        successCount: run.successCount,
        failureCount: run.failureCount,
        retryCount: run.retryCount,
        nextRetryAt: run.nextRetryAt,
        finishedAt: run.finishedAt,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to deliver announcement batch.";
    const status = message.includes("already being delivered")
      ? 409
      : message.includes("configuration is unavailable") || message.includes("database is offline")
        ? 503
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
