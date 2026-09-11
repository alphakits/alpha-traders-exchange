import { NextRequest } from "next/server";
import {
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
import { compareMobileAppVersions } from "@/lib/mobile-version-policy";
import { hasRole } from "@/lib/roles";

const RESOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const TRON_TX_ID_PATTERN = /^[A-Fa-f0-9]{64}$/;
const EXACT_COMMISSION_AMOUNT_MIN_APP_VERSION = "1.2.0";

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
    // `amountDue` existed before exact per-payment suffixes were introduced.
    // Keep old installed clients safe by returning the exact transfer amount
    // in that field as well as the new explicit `paymentAmountDue` field.
    payableRecords: status.payableRecords.map((record) => ({
      ...record,
      amountDue: record.paymentAmountDue ?? record.amountDue,
    })),
    paymentNetworks: paymentNetworks(),
  };
}

async function requireSeller(request: NextRequest, requestId: string) {
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return { response: mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400) };
  const versionComparison = compareMobileAppVersions(metadata.appVersion, EXACT_COMMISSION_AMOUNT_MIN_APP_VERSION);
  if (versionComparison === null || versionComparison < 0) {
    return { response: mobileError("APP_UPDATE_REQUIRED", requestId, locale, 426) };
  }
  const auth = await requireMobileApiUser(request, requestId, metadata);
  if (!auth.user) return { response: auth.unauthorized };
  const canSettleCommission = hasRole(auth.user, "approved_seller")
    || hasRole(auth.user, "pending_seller_approval")
    || hasRole(auth.user, "admin")
    || hasRole(auth.user, "owner")
    || auth.user.sellerStatus === "suspended";
  if (!canSettleCommission) return { response: mobileError("SELLER_ROLE_REQUIRED", requestId, locale, 403) };
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
    if (!RESOURCE_ID_PATTERN.test(commissionId) || !isCommissionNetwork(network) || !TRON_TX_ID_PATTERN.test(paymentSignature)) {
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
