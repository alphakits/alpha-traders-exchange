import { NextRequest, NextResponse } from "next/server";
import { requireApiSellerWorkspaceActor } from "@/lib/api-auth";
import { checkSharedRateLimit } from "@/lib/rate-limit";
import { getCommissionCheckoutRuntime } from "@/lib/commission-checkout-runtime";
import { CommissionCheckoutError } from "@/lib/commission-checkout-workflow";
import { resolveCommissionWalletForNetwork } from "@/lib/commission-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;
const headers = { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex" };
async function actor() {
  const result = await requireApiSellerWorkspaceActor();
  if (result.unauthorized) for (const [key, value] of Object.entries(headers)) result.unauthorized.headers.set(key, value);
  return result;
}
export async function GET() {
  const { user, unauthorized } = await actor();
  if (!user) return unauthorized;
  try {
    const service = await getCommissionCheckoutRuntime();
    const state = await service.state(user.id);
    const rail = state.checkout ? resolveCommissionWalletForNetwork(state.checkout.network) : null;
    if (rail && !rail.available) throw new Error("Destination unavailable");
    return NextResponse.json({ ...state, walletAddress: rail?.available ? rail.walletAddress : null,
      checkedAt: new Date().toISOString(), toleranceUsdt: 1, ownerApprovalRequired: false }, { headers });
  } catch {
    return NextResponse.json({ error: "CHECKOUT_UNAVAILABLE" }, { status: 503, headers });
  }
}
export async function POST(request: NextRequest) {
  const { user, unauthorized } = await actor();
  if (!user) return unauthorized;
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "SAME_ORIGIN_REQUIRED" }, { status: 403, headers });
  const rate = await checkSharedRateLimit({ headers: request.headers, key: `exchange:commission-checkout:${user.id}`, maxRequests: 8, windowMs: 60_000 });
  if (!rate.allowed) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) } });
  try {
    if (Number(request.headers.get("content-length")) > 4096) return NextResponse.json({ error: "REQUEST_TOO_LARGE" }, { status: 413, headers });
    const raw = await request.text();
    if (raw.length > 4096) return NextResponse.json({ error: "REQUEST_TOO_LARGE" }, { status: 413, headers });
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400, headers }); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400, headers });
    const value = body as Record<string, unknown>;
    if (Object.keys(value).some((key) => !["network", "desiredAmount", "hasNotPaidYet"].includes(key))
      || value.hasNotPaidYet !== true || (value.network !== "TRC20" && value.network !== "BEP20")
      || (value.desiredAmount !== undefined && (typeof value.desiredAmount !== "string" || value.desiredAmount.length > 32))) {
      return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400, headers });
    }
    const service = await getCommissionCheckoutRuntime();
    const checkout = await service.issue({ sellerId: user.id, network: value.network, desiredAmount: value.desiredAmount as string | undefined });
    const rail = resolveCommissionWalletForNetwork(checkout.network);
    if (!rail.available) throw new Error("Destination unavailable");
    return NextResponse.json({ status: "waiting", checkout, walletAddress: rail.walletAddress,
      message: "Send the displayed amount once. Verification and settlement are automatic; no owner approval is required." }, { status: 201, headers });
  } catch (error) {
    if (error instanceof CommissionCheckoutError) return NextResponse.json({ error: error.code }, { status: error.code === "seller_required" ? 403 : 409, headers });
    return NextResponse.json({ error: "CHECKOUT_UNAVAILABLE" }, { status: 503, headers });
  }
}
