import { NextRequest } from "next/server";
import { getTradeRoomBankDetails, getTradeRoomData } from "@/lib/alpha-exchange-store";
import { requireMobileApiUser } from "@/lib/mobile-api-auth";
import {
  createMobileRequestId,
  mobileError,
  mobileJson,
  parseMobileClientMetadata,
  resolveMobileLocale,
} from "@/lib/mobile-api";
import { isMobileTradeParticipant, mobileTradeErrorCode, mobileTradeErrorStatus } from "@/lib/mobile-trades";
import { logEvent } from "@/lib/structured-logging";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

const RESOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export async function GET(request: NextRequest, context: RouteContext) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400);
  const params = await context.params;
  if (!RESOURCE_ID_PATTERN.test(params.requestId)) {
    return mobileError("INVALID_REQUEST", requestId, locale, 400);
  }
  try {
    const auth = await requireMobileApiUser(request, requestId, metadata);
    if (!auth.user) return auth.unauthorized;
    const room = await getTradeRoomData({
      purchaseRequestId: params.requestId,
      actorUserId: auth.user.id,
      actorRole: auth.user.role,
      markMessagesRead: false,
      strongConsistency: true,
    });
    if (!isMobileTradeParticipant(room.request, auth.user.id) || room.request.buyerId !== auth.user.id) {
      return mobileError("TRADE_NOT_FOUND", requestId, locale, 404);
    }
    const details = await getTradeRoomBankDetails({
      purchaseRequestId: params.requestId,
      actorUserId: auth.user.id,
      actorRole: auth.user.role,
    });
    return mobileJson({
      bankDetails: {
        accountHolderName: details.accountHolderName,
        bankName: details.bankName,
        branchNumber: details.branchNumber,
        accountNumber: details.accountNumber,
        accountLast4: details.accountLast4,
      },
    }, requestId);
  } catch (error) {
    const code = mobileTradeErrorCode(error);
    if (code) return mobileError(code, requestId, locale, mobileTradeErrorStatus(code));
    logEvent("error", {
      event: "mobile_trade_bank_details",
      outcome: "failed",
      reason: "service_unavailable",
      metadata: { errorType: error instanceof Error ? error.name : typeof error, requestId },
    });
    return mobileError("SERVICE_UNAVAILABLE", requestId, locale, 503);
  }
}
