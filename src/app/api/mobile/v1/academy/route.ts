import { NextRequest } from "next/server";
import { requireMobileApiUser } from "@/lib/mobile-api-auth";
import {
  createMobileRequestId,
  mobileError,
  mobileJson,
  parseMobileClientMetadata,
  resolveMobileLocale,
} from "@/lib/mobile-api";
import { getMobileAcademyCatalog } from "@/lib/mobile-academy";

export async function GET(request: NextRequest) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400);

  const auth = await requireMobileApiUser(request, requestId, metadata);
  if (auth.unauthorized) return auth.unauthorized;

  return mobileJson(getMobileAcademyCatalog(), requestId);
}
