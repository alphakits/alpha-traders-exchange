import { NextRequest } from "next/server";
import {
  canPublishListings,
  getSellerCommissionStatus,
  submitSellerCommissionWalletPayment,
} from "@/lib/alpha-exchange-store";
import {
  COMMISSION_NETWORKS,
  resolveCommissionWalletForNetwork,
  type CommissionNetworkId,
} from "@/lib/commission-config";
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

function isCommissionNetwork(value: string): value is CommissionNetworkId {
  return value === "TRC20";
}

function paymentNetworks() {
  return COMMISSION_NETWORKS.map((network) => {
    const resolved = resolveCommissionWalletForNetwork(network.id);
    return resolved.available
      ? {
          network: network.id,
          label: network.label,
          available: true,
          walletAddress: resolved.walletAddress,
        }
      : {
          network: network.id,
          label: network.label,
          available: false,
          error: resolved.error,
        };
  });
}

async function responsePayload(sellerId: string) {
  const status = await getSellerCommissionStatus(sellerId);
  return {
    status: status.status,
    pendingCount: status.pendingCount,
    totalAmountDue: status.totalAmountDue,
    payableRecords: status.payableRecords,
    paymentNetworks: paymentNetworks(),
  };
}

async function requireSeller(request: NextRequest, requestId: string) {
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return { response: mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400) };
  const auth = await requireMobileApiUser(request, requestId, metadata);
  if (!auth.user) return { response: auth.unauthorized };
  if (!canPublishListings(auth.user)) return { response: mobileError("SELLER_ROLE_REQUIRED", requestId, locale, 403) };
  return { user: auth.user };
}

export async function GET(request: NextRequest) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  try {
    const auth = await requireSeller(request, requestId);
    if (auth.response) return auth.response;
    return mobileJson(await responsePayload(auth.user.id), requestId);
  } catch (error) {
    logEvent("error", {
      event: "mobile_seller_commissions",
      outcome: "failed",
      reason: "service_unavailable",
      metadata: { errorType: error instanceof Error ? error.name : typeof error, requestId },
    });
    return mobileError("SERVICE_UNAVAILABLE", requestId, locale, 503);
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
      key: "mobile:seller-commission-pay",
      maxRequests: 20,
      windowMs: 60_000,
    });
    if (!rate.allowed) return mobileError("RATE_LIMITED", requestId, locale, 429, { retryAfterSeconds: rate.retryAfterSeconds });
    const body = await readMobileJsonBody(request);
    const commissionId = String(body?.commissionId ?? "").trim();
    const network = String(body?.network ?? "").trim().toUpperCase();
    const paymentSignature = String(body?.paymentSignature ?? "").trim();
    if (!RESOURCE_ID_PATTERN.test(commissionId) || !isCommissionNetwork(network) || paymentSignature.length < 16 || paymentSignature.length > 200) {
      return mobileError("INVALID_REQUEST", requestId, locale, 400);
    }
    const submission = await submitSellerCommissionWalletPayment({
      sellerUserId: auth.user.id,
      commissionId,
      network,
      payerWalletAddress: "",
      paymentSignature,
    });
    return mobileJson({
      ...await responsePayload(auth.user.id),
      verification: submission.verification,
    }, requestId);
  } catch (error) {
    logEvent("error", {
      event: "mobile_seller_commission_payment",
      outcome: "failed",
      reason: "verification_failed",
      metadata: { errorType: error instanceof Error ? error.name : typeof error, requestId },
    });
    return mobileError("INVALID_REQUEST", requestId, locale, 400);
  }
}
