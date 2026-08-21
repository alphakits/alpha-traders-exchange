import { NextRequest, NextResponse } from "next/server";
import { mapTwilioStatus, validateTwilioSignature } from "@/lib/notification-platform";
import { updateSmsDeliveryStatus } from "@/lib/alpha-exchange-store";
import { getSiteUrl } from "@/lib/site-url";

export async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const params = Object.fromEntries(Array.from(form.entries()).map(([key, value]) => [key, String(value)]));
  const url = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, getSiteUrl()).toString();
  if (!validateTwilioSignature({ signature: request.headers.get("x-twilio-signature"), url, params })) {
    return new NextResponse(null, { status: 403 });
  }
  const status = mapTwilioStatus(params.MessageStatus ?? params.SmsStatus ?? "");
  if (!status || !params.MessageSid) return new NextResponse(null, { status: 400 });
  const updated = await updateSmsDeliveryStatus({
    deliveryId: request.nextUrl.searchParams.get("deliveryId") ?? undefined,
    messageSid: params.MessageSid,
    status,
    providerStatus: params.MessageStatus ?? params.SmsStatus ?? "",
  });
  if (!updated) return new NextResponse(null, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
