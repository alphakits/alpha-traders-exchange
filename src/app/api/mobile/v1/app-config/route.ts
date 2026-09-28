import { NextRequest } from "next/server";
import type { MobileAppConfigResponse } from "@alpha-traders/contracts";
import {
  createMobileRequestId,
  mobileError,
  mobileJson,
  parseMobileClientMetadata,
  resolveMobileLocale,
} from "@/lib/mobile-api";
import { resolveMobileVersionPolicy } from "@/lib/mobile-version-policy";

// App startup waits for this policy before the WebView becomes interactive.
// Keep it on the edge: it is pure configuration work and does not need the
// Node.js/database runtime or its cold-start path.
export const runtime = "edge";

export async function GET(request: NextRequest) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400);

  const policy = resolveMobileVersionPolicy(metadata.platform, metadata.appVersion);
  const payload = {
    ...policy,
    checkedAt: new Date().toISOString(),
  } satisfies Omit<MobileAppConfigResponse, "requestId">;
  return mobileJson(payload, requestId);
}
