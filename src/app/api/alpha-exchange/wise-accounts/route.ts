import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, requireMarketplaceVerificationForTrading } from "@/lib/api-auth";
import { deleteWiseAccount, getWiseAccountsForUser, saveWiseAccount } from "@/lib/alpha-exchange-store";
import { isWisePaymentsEnabled, getWisePaymentsMode } from "@/lib/wise-payments-capability";
import { checkSharedRateLimit } from "@/lib/rate-limit";

const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
const detailKeys = new Set(["provider", "currency", "countryCode", "accountHolderType", "accountHolderName", "bankName", "bankAddress", "routingNumber", "accountNumber", "accountType"]);
function fail(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Wise account request failed." }, { status: 400, headers });
}
export async function GET() {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  if (!isWisePaymentsEnabled()) return NextResponse.json({ enabled: false, mode: "disabled", accounts: [] }, { headers });
  const verification = requireMarketplaceVerificationForTrading(user);
  if (verification) return verification;
  try { return NextResponse.json({ enabled: true, mode: getWisePaymentsMode(), accounts: await getWiseAccountsForUser(user.id) }, { headers }); }
  catch (error) { return fail(error); }
}
async function mutate(request: NextRequest, update: boolean) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  if (!isWisePaymentsEnabled()) return NextResponse.json({ error: "Wise USD bank transfers are unavailable." }, { status: 403, headers });
  const verification = requireMarketplaceVerificationForTrading(user);
  if (verification) return verification;
  const rate = await checkSharedRateLimit({ headers: request.headers, key: "wise-account-write", identifier: user.id, maxRequests: 10, windowMs: 60_000 });
  if (!rate.allowed) return NextResponse.json({ error: "Too many account requests." }, { status: 429, headers });
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid account details.");
    const value = body as Record<string, unknown>;
    if (Object.keys(value).some(key => !detailKeys.has(key) && !(update && key === "accountId"))) throw new Error("Unsupported account field.");
    const accountId = update && typeof value.accountId === "string" ? value.accountId.trim() : undefined;
    if (update && !accountId) throw new Error("Account ID is required.");
    const account = await saveWiseAccount({ actorUserId: user.id, accountId, details: value });
    return NextResponse.json({ account, accounts: await getWiseAccountsForUser(user.id) }, { status: update ? 200 : 201, headers });
  } catch (error) { return fail(error); }
}
export async function POST(request: NextRequest) { return mutate(request, false); }
export async function PATCH(request: NextRequest) { return mutate(request, true); }
export async function DELETE(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  if (!isWisePaymentsEnabled()) return NextResponse.json({ error: "Wise USD bank transfers are unavailable." }, { status: 403, headers });
  const verification = requireMarketplaceVerificationForTrading(user);
  if (verification) return verification;
  try {
    const accountId = request.nextUrl.searchParams.get("accountId")?.trim();
    if (!accountId) throw new Error("Account ID is required.");
    await deleteWiseAccount({ actorUserId: user.id, accountId });
    return NextResponse.json({ accounts: await getWiseAccountsForUser(user.id) }, { headers });
  } catch (error) { return fail(error); }
}
