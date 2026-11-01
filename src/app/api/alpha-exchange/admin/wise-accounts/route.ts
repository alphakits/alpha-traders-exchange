import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { getWiseAccountReviewQueue, reviewWiseAccount } from "@/lib/alpha-exchange-store";
import { isWisePaymentsEnabled } from "@/lib/wise-payments-capability";
import { hasRole } from "@/lib/roles";
import { checkSharedRateLimit } from "@/lib/rate-limit";

const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
async function authorize() {
  const result = await requireApiUser();
  if (!result.user) return result;
  if (!isWisePaymentsEnabled() || (!hasRole(result.user, "admin") && !hasRole(result.user, "owner"))) {
    return { user: null, unauthorized: NextResponse.json({ error: "Wise account review is unavailable." }, { status: 403, headers }) };
  }
  return result;
}
export async function GET() {
  const { user, unauthorized } = await authorize();
  if (!user) return unauthorized;
  try { return NextResponse.json({ accounts: await getWiseAccountReviewQueue(user.id) }, { headers }); }
  catch { return NextResponse.json({ error: "Account review is unavailable." }, { status: 403, headers }); }
}
export async function PATCH(request: NextRequest) {
  const { user, unauthorized } = await authorize();
  if (!user) return unauthorized;
  const rate = await checkSharedRateLimit({ headers: request.headers, key: "wise-account-review", identifier: user.id, maxRequests: 20, windowMs: 60_000 });
  if (!rate.allowed) return NextResponse.json({ error: "Too many review requests." }, { status: 429, headers });
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid review.");
    const value = body as Record<string, unknown>;
    const keys = ["userId", "accountId", "decision", "evidenceReference", "verifiedAccountHolderName", "identityMatched", "expectedReviewVersion"];
    if (Object.keys(value).some(key => !keys.includes(key))) throw new Error("Unsupported review field.");
    if (typeof value.userId !== "string" || typeof value.accountId !== "string" || typeof value.evidenceReference !== "string"
      || typeof value.expectedReviewVersion !== "string" || !/^[a-f0-9]{64}$/.test(value.expectedReviewVersion)
      || (value.decision !== "approve" && value.decision !== "reject")) throw new Error("Complete the account review details.");
    const account = await reviewWiseAccount({ actorUserId: user.id, userId: value.userId, accountId: value.accountId,
      decision: value.decision, evidenceReference: value.evidenceReference,
      expectedReviewVersion: value.expectedReviewVersion,
      verifiedAccountHolderName: typeof value.verifiedAccountHolderName === "string" ? value.verifiedAccountHolderName : undefined,
      identityMatched: value.identityMatched === true });
    return NextResponse.json({ account }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Ownership review failed." }, { status: 400, headers });
  }
}
