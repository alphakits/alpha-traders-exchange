import { NextRequest } from "next/server";
import { requireMobileApiUser } from "@/lib/mobile-api-auth";
import {
  createMobileRequestId,
  mobileError,
  mobileJson,
  parseMobileClientMetadata,
  resolveMobileLocale,
} from "@/lib/mobile-api";
import { getMobileAcademyLesson, isMobileAcademySlug } from "@/lib/mobile-academy";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400);

  const { slug } = await context.params;
  if (!isMobileAcademySlug(slug)) {
    return mobileError("INVALID_REQUEST", requestId, locale, 400);
  }

  const auth = await requireMobileApiUser(request, requestId, metadata);
  if (auth.unauthorized) return auth.unauthorized;

  const payload = getMobileAcademyLesson(slug);
  if (!payload) return mobileError("NOT_FOUND", requestId, locale, 404);
  return mobileJson(payload, requestId);
}
