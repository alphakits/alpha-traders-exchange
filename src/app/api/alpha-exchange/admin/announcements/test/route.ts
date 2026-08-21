import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { sendAdminAnnouncementTest } from "@/lib/alpha-exchange-store";
import { checkSharedRateLimit, createRateLimitResponse } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;
  const limit = await checkSharedRateLimit({
    headers: request.headers,
    key: "admin-announcement-test",
    identifier: user.id,
    maxRequests: 10,
    windowMs: 60 * 60_000,
  });
  if (!limit.allowed) return createRateLimitResponse(limit.retryAfterSeconds);

  try {
    const body = await request.json();
    const result = await sendAdminAnnouncementTest({
      adminUserId: user.id,
      recipientEmail: String(body.recipientEmail ?? ""),
      content: {
        subject: String(body.subject ?? ""),
        title: String(body.title ?? ""),
        content: String(body.content ?? ""),
        ctaText: String(body.ctaText ?? ""),
        ctaUrl: String(body.ctaUrl ?? ""),
      },
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.reason === "resend_not_configured" ? "Resend is not configured." : "Resend rejected the test email." },
        { status: 502 },
      );
    }
    return NextResponse.json({ sent: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send test announcement." },
      { status: 400 },
    );
  }
}
