import { NextRequest, NextResponse } from "next/server";
import { requireApiOwner } from "@/lib/api-auth";
import { checkSharedRateLimit } from "@/lib/rate-limit";
import { getCommissionBatchRuntime } from "@/lib/commission-batch-runtime";
import { CommissionBatchError } from "@/lib/commission-batch-workflow";
import { commissionReceiptKey } from "@/lib/commission-batch-policy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;
const headers = { "Cache-Control": "no-store, max-age=0" };
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
export async function GET() {
  const { user, unauthorized } = await requireApiOwner();
  if (!user) return unauthorized;
  try {
    const service = await getCommissionBatchRuntime();
    return NextResponse.json({ ...await service.ownerState(),
      enabled: process.env.ALPHA_EXCHANGE_COMMISSION_BATCH_V1 === "1",
      toleranceUsdt: 1, attributionRequired: true }, { headers });
  } catch {
    return NextResponse.json({ error: "Commission reconciliation is temporarily unavailable." }, { status: 503, headers });
  }
}
export async function POST(request: NextRequest) {
  const { user, unauthorized } = await requireApiOwner();
  if (!user) return unauthorized;
  if (process.env.ALPHA_EXCHANGE_COMMISSION_BATCH_V1 !== "1") {
    return NextResponse.json({ error: "Combined settlement has not been enabled for this deployment." }, { status: 503, headers });
  }
  // Browser-only owner approval: reject cross-origin and missing-origin requests.
  // The caller cannot nominate an owner ID, waive more than policy, or assert a receipt amount.
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Same-origin owner approval is required." }, { status: 403, headers });
  }
  const rate = await checkSharedRateLimit({ headers: request.headers, key: `exchange:batch-receipt:${user.id}`,
    maxRequests: 10, windowMs: 60_000 });
  if (!rate.allowed) return NextResponse.json({ error: "Too many approval attempts." }, {
    status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) },
  });
  try {
    if (Number(request.headers.get("content-length") ?? "0") > 16_384) {
      return NextResponse.json({ error: "Request is too large." }, { status: 413, headers });
    }
    const raw = await request.text();
    if (raw.length > 16_384) return NextResponse.json({ error: "Request is too large." }, { status: 413, headers });
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400, headers }); }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid approval." }, { status: 400, headers });
    }
    const input = body as Record<string, unknown>;
    if (typeof input.sellerId !== "string" || !idPattern.test(input.sellerId)
      || !Array.isArray(input.commissionIds) || !input.commissionIds.length || input.commissionIds.length > 100
      || input.commissionIds.some((id) => typeof id !== "string" || !idPattern.test(id))
      || new Set(input.commissionIds).size !== input.commissionIds.length
      || typeof input.signature !== "string" || input.signature.length > 128 || !commissionReceiptKey(input.signature)
      || (input.network !== "TRC20" && input.network !== "BEP20") || input.confirmedOriginalPayer !== true) {
      return NextResponse.json({ error: "Select the original receipt, its network, and this seller's commissions. Confirm the payer from independent evidence, not the amount alone." }, { status: 400, headers });
    }
    const service = await getCommissionBatchRuntime();
    const batch = await service.approve({ actorUserId: user.id, sellerId: input.sellerId,
      commissionIds: input.commissionIds as string[], signature: input.signature, network: input.network });
    return NextResponse.json({ batchId: batch.id, expectedAmountUsdt: batch.expectedAmountMicros / 1e6,
      status: "awaiting_receipt_verification", message: "Receipt association saved. Automatic scanning must independently verify the payment before any commission is marked paid." },
    { status: 202, headers });
  } catch (error) {
    if (error instanceof CommissionBatchError) {
      return NextResponse.json({ error: error.code }, { status: error.code === "owner_required" ? 403 : 409, headers });
    }
    return NextResponse.json({ error: "Approval could not be saved. Refresh before retrying; do not send another payment." }, { status: 503, headers });
  }
}
