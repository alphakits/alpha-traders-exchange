import { NextRequest } from "next/server";
import {
  addSellerBankAccount,
  canPublishListings,
  deleteSellerBankAccount,
  getSellerBankAccountsForUser,
} from "@/lib/alpha-exchange-store";
import { requireMobileApiUser } from "@/lib/mobile-api-auth";
import {
  createMobileRequestId,
  mobileError,
  mobileJson,
  parseMobileClientMetadata,
  readMobileJsonBody,
  resolveMobileLocale,
} from "@/lib/mobile-api";
import { checkSharedRateLimit } from "@/lib/rate-limit";
import { logEvent } from "@/lib/structured-logging";

const RESOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

async function requireSeller(request: NextRequest, requestId: string) {
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return { response: mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400) };
  const auth = await requireMobileApiUser(request, requestId, metadata);
  if (!auth.user) return { response: auth.unauthorized };
  if (!canPublishListings(auth.user)) {
    return { response: mobileError("SELLER_ROLE_REQUIRED", requestId, locale, 403) };
  }
  return { user: auth.user, locale };
}

export async function GET(request: NextRequest) {
  const requestId = createMobileRequestId(request);
  try {
    const auth = await requireSeller(request, requestId);
    if (auth.response) return auth.response;
    return mobileJson({ bankAccounts: await getSellerBankAccountsForUser(auth.user.id) }, requestId);
  } catch (error) {
    logEvent("error", {
      event: "mobile_seller_bank_accounts_list",
      outcome: "failed",
      reason: "service_unavailable",
      metadata: { errorType: error instanceof Error ? error.name : typeof error, requestId },
    });
    return mobileError("SERVICE_UNAVAILABLE", requestId, resolveMobileLocale(request), 503);
  }
}

export async function POST(request: NextRequest) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  try {
    const auth = await requireSeller(request, requestId);
    if (auth.response) return auth.response;
    const rate = await checkSharedRateLimit({
      headers: request.headers,
      key: "mobile:seller-bank-account-create",
      maxRequests: 8,
      windowMs: 60_000,
    });
    if (!rate.allowed) {
      return mobileError("RATE_LIMITED", requestId, locale, 429, { retryAfterSeconds: rate.retryAfterSeconds });
    }
    const body = await readMobileJsonBody(request);
    const accountHolderName = String(body?.accountHolderName ?? "").trim();
    const bankName = String(body?.bankName ?? "").trim();
    const branchNumber = String(body?.branchNumber ?? "").trim();
    const accountNumber = String(body?.accountNumber ?? "").trim();
    if (!accountHolderName || !bankName || !branchNumber || !accountNumber) {
      return mobileError("INVALID_REQUEST", requestId, locale, 400);
    }
    await addSellerBankAccount({
      sellerId: auth.user.id,
      actorUserId: auth.user.id,
      accountHolderName,
      bankName,
      branchNumber,
      accountNumber,
      isDefault: body?.isDefault === true,
    });
    return mobileJson({ bankAccounts: await getSellerBankAccountsForUser(auth.user.id) }, requestId, { status: 201 });
  } catch (error) {
    logEvent("error", {
      event: "mobile_seller_bank_account_create",
      outcome: "failed",
      reason: "invalid_or_unavailable",
      metadata: { errorType: error instanceof Error ? error.name : typeof error, requestId },
    });
    return mobileError("INVALID_REQUEST", requestId, locale, 400);
  }
}

export async function DELETE(request: NextRequest) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  try {
    const auth = await requireSeller(request, requestId);
    if (auth.response) return auth.response;
    const bankAccountId = request.nextUrl.searchParams.get("bankAccountId")?.trim() ?? "";
    if (!RESOURCE_ID_PATTERN.test(bankAccountId)) {
      return mobileError("INVALID_REQUEST", requestId, locale, 400);
    }
    const rate = await checkSharedRateLimit({
      headers: request.headers,
      key: "mobile:seller-bank-account-delete",
      maxRequests: 8,
      windowMs: 60_000,
    });
    if (!rate.allowed) {
      return mobileError("RATE_LIMITED", requestId, locale, 429, { retryAfterSeconds: rate.retryAfterSeconds });
    }
    await deleteSellerBankAccount({ sellerId: auth.user.id, actorUserId: auth.user.id, bankAccountId });
    return mobileJson({ bankAccounts: await getSellerBankAccountsForUser(auth.user.id) }, requestId);
  } catch (error) {
    logEvent("error", {
      event: "mobile_seller_bank_account_delete",
      outcome: "failed",
      reason: "invalid_or_unavailable",
      metadata: { errorType: error instanceof Error ? error.name : typeof error, requestId },
    });
    return mobileError("LISTING_ACTION_NOT_ALLOWED", requestId, locale, 409);
  }
}
