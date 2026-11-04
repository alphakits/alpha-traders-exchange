import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { sendAdminAnnouncementTest } from "@/lib/alpha-exchange-store";
import { checkSharedRateLimit, createRateLimitResponse } from "@/lib/rate-limit";
import { hasRole } from "@/lib/roles";
import { readLimitedRequestText, RequestBodyTooLargeError } from "@/lib/request-body";

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
    const body = JSON.parse(await readLimitedRequestText(request, 3 * 1024 * 1024));
    if (body.attachment !== undefined && !hasRole(user, "owner")) {
      return NextResponse.json({ error: "PDF attachments are restricted to the owner and approved sellers." }, { status: 403 });
    }
    const result = await sendAdminAnnouncementTest({
      adminUserId: user.id,
      recipientEmail: String(body.recipientEmail ?? ""),
      attachment: body.attachment,
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
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "Announcement upload is too large. PDFs must be no larger than 2 MB." }, { status: 413 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send test announcement." },
      { status: 400 },
    );
  }
}
