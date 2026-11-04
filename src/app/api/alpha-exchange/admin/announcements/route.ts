import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import {
  createAdminAnnouncementRun,
  getAdminAnnouncementOverview,
  isAdminAnnouncementAudience,
} from "@/lib/alpha-exchange-store";
import { checkSharedRateLimit, createRateLimitResponse } from "@/lib/rate-limit";
import type { AdminAnnouncementRun } from "@/types/alpha-exchange";
import { hasRole } from "@/lib/roles";
import { readLimitedRequestText, RequestBodyTooLargeError } from "@/lib/request-body";

function toPublicRun(run: AdminAnnouncementRun) {
  return {
    id: run.id,
    audience: run.audience,
    subject: run.subject,
    title: run.title,
    status: run.status,
    recipientCount: run.recipientCount,
    successCount: run.successCount,
    failureCount: run.failureCount,
    retryCount: run.retryCount,
    nextRetryAt: run.nextRetryAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    attachment: run.attachment ? {
      filename: run.attachment.filename,
      sizeBytes: run.attachment.sizeBytes,
      sha256: run.attachment.sha256,
    } : undefined,
  };
}

export async function GET(request: NextRequest) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;
  const limit = await checkSharedRateLimit({
    headers: request.headers,
    key: "admin-announcement-overview",
    identifier: user.id,
    maxRequests: 120,
    windowMs: 60 * 60_000,
  });
  if (!limit.allowed) return createRateLimitResponse(limit.retryAfterSeconds);

  const audience = request.nextUrl.searchParams.get("audience") ?? "";
  if (!isAdminAnnouncementAudience(audience)) {
    return NextResponse.json({ error: "Invalid announcement audience." }, { status: 400 });
  }
  const attachment = request.nextUrl.searchParams.get("attachment") === "pdf";
  if (attachment && (!hasRole(user, "owner") || audience !== "approved_sellers")) {
    return NextResponse.json({ error: "PDF attachments are restricted to the owner and approved sellers." }, { status: 403 });
  }
  const overview = await getAdminAnnouncementOverview(audience, { attachment });
  return NextResponse.json({
    recipientCount: overview.recipientCount,
    runs: overview.runs.map(toPublicRun),
  });
}

export async function POST(request: NextRequest) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;
  const limit = await checkSharedRateLimit({
    headers: request.headers,
    key: "admin-announcement-create",
    identifier: user.id,
    maxRequests: 5,
    windowMs: 60 * 60_000,
  });
  if (!limit.allowed) return createRateLimitResponse(limit.retryAfterSeconds);

  try {
    const body = JSON.parse(await readLimitedRequestText(request, 3 * 1024 * 1024));
    const audience = String(body.audience ?? "");
    if (!isAdminAnnouncementAudience(audience)) {
      return NextResponse.json({ error: "Invalid announcement audience." }, { status: 400 });
    }
    if (body.attachment !== undefined && (!hasRole(user, "owner") || audience !== "approved_sellers")) {
      return NextResponse.json({ error: "PDF attachments are restricted to the owner and approved sellers." }, { status: 403 });
    }
    const expectedRecipientCount = Number(body.expectedRecipientCount);
    if (!Number.isInteger(expectedRecipientCount) || expectedRecipientCount < 1) {
      return NextResponse.json({ error: "A valid recipient count confirmation is required." }, { status: 400 });
    }
    const run = await createAdminAnnouncementRun({
      adminUserId: user.id,
      requestKey: String(body.requestKey ?? ""),
      audience,
      expectedRecipientCount,
      attachment: body.attachment,
      content: {
        subject: String(body.subject ?? ""),
        title: String(body.title ?? ""),
        content: String(body.content ?? ""),
        ctaText: String(body.ctaText ?? ""),
        ctaUrl: String(body.ctaUrl ?? ""),
      },
    });
    return NextResponse.json({ run: toPublicRun(run) }, { status: 201 });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "Announcement upload is too large. PDFs must be no larger than 2 MB." }, { status: 413 });
    }
    const message = error instanceof Error ? error.message : "Failed to create announcement delivery.";
    return NextResponse.json({ error: message }, { status: message.startsWith("Recipient count changed") ? 409 : 400 });
  }
}
