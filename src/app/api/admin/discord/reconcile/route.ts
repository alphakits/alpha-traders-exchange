import { type NextRequest, NextResponse } from "next/server";

import { requireApiAdmin } from "@/lib/api-auth";
import { enqueueDiscordOperatorReconciliation } from "@/lib/discord/management";
import {
  checkRateLimit,
  createRateLimitResponse,
} from "@/lib/rate-limit";
import { hasTrustedSameOrigin } from "@/lib/request-origin";
import { logEvent } from "@/lib/structured-logging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IDEMPOTENCY_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;
  if (!hasTrustedSameOrigin(request)) {
    return NextResponse.json(
      { error: "Trusted same-origin request required." },
      { status: 403 },
    );
  }
  const rate = checkRateLimit({
    headers: request.headers,
    key: "admin:discord-reconcile",
    identifier: user.id,
    maxRequests: 3,
    windowMs: 60 * 60 * 1000,
  });
  if (!rate.allowed) return createRateLimitResponse(rate.retryAfterSeconds);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid reconciliation request." }, { status: 400 });
  }
  const candidate = body as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  if (
    keys.length !== 2
    || keys[0] !== "confirmation"
    || keys[1] !== "idempotencyKey"
    || candidate.confirmation !== "reconcile_managed_integration"
    || typeof candidate.idempotencyKey !== "string"
    || !IDEMPOTENCY_KEY_PATTERN.test(candidate.idempotencyKey)
  ) {
    return NextResponse.json(
      { error: "Explicit reconciliation confirmation is required." },
      { status: 400 },
    );
  }

  try {
    const result = await enqueueDiscordOperatorReconciliation({
      actorUserId: user.id,
      idempotencyKey: candidate.idempotencyKey,
    });
    logEvent("info", {
      event: "discord_operator_reconciliation_requested",
      actorUserId: user.id,
      actorRole: user.role,
      outcome: "success",
      reason: result.disposition,
    });
    return NextResponse.json(
      {
        action: "reconcile_managed_integration",
        disposition: result.disposition,
        status: result.status,
        acceptedAt: result.acceptedAt,
        resultCode: result.resultCode,
        explanation:
          "Railway will reconcile integration-owned resources, commands, listings, and live content. No arbitrary Discord object is targeted.",
      },
      {
        status:
          result.disposition === "replayed"
          && (result.status === "completed" || result.status === "dead")
            ? 200
            : 202,
        headers: { "Cache-Control": "no-store, max-age=0" },
      },
    );
  } catch (error) {
    logEvent("error", {
      event: "discord_operator_reconciliation_requested",
      actorUserId: user.id,
      actorRole: user.role,
      outcome: "failed",
      reason: "request_persistence_failed",
      metadata: {
        errorType: error instanceof Error ? error.name : typeof error,
      },
    });
    return NextResponse.json(
      {
        error: "The reconciliation request could not be persisted.",
        code: "request_persistence_failed",
      },
      { status: 503 },
    );
  }
}
