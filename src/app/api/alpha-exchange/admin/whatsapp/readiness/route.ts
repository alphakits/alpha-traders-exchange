import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import {
  WHATSAPP_AUTHENTICATION_TEMPLATE_NAME,
  WHATSAPP_EVENT_TEMPLATES,
  buildWhatsAppAuthenticationTemplatePayload,
  buildWhatsAppTemplatePayload,
  getWhatsAppAuthenticationReadiness,
  getWhatsAppCloudReadiness,
  type WhatsAppEventType,
} from "@/lib/whatsapp-platform";
import { getPhoneVerificationProvider } from "@/lib/phone-verification-delivery";
import {
  CURRENT_WHATSAPP_CONSENT_VERSION,
  getWhatsAppDeliveryOperationsSummary,
  isWhatsAppChannelAvailable,
} from "@/lib/whatsapp-notifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;

  const provider = getWhatsAppCloudReadiness();
  const authenticationProvider = getWhatsAppAuthenticationReadiness();
  const selectedPhoneVerificationProvider = getPhoneVerificationProvider();
  const events = Object.keys(WHATSAPP_EVENT_TEMPLATES) as WhatsAppEventType[];
  const operations = await getWhatsAppDeliveryOperationsSummary();
  return NextResponse.json({
    mode: provider.readyToSend ? "configuration_ready" : "simulation_only",
    readinessScope: "local_configuration_only",
    endToEndVerified: false,
    provider,
    authentication: {
      mode: authenticationProvider.readyToSend ? "configuration_ready" : "simulation_only",
      selectedPhoneVerificationProvider: selectedPhoneVerificationProvider ?? "invalid_configuration",
      readiness: authenticationProvider,
      template: {
        name: WHATSAPP_AUTHENTICATION_TEMPLATE_NAME,
        simulatedPayloads: {
          en: buildWhatsAppAuthenticationTemplatePayload({
            to: "+15550000000",
            code: "000000",
            locale: "en",
          }),
          ar: buildWhatsAppAuthenticationTemplatePayload({
            to: "+15550000000",
            code: "000000",
            locale: "ar",
          }),
        },
      },
    },
    consent: {
      available: isWhatsAppChannelAvailable(),
      version: CURRENT_WHATSAPP_CONSENT_VERSION,
    },
    operations,
    templates: events.map((event) => ({
      event,
      name: WHATSAPP_EVENT_TEMPLATES[event].name,
      previews: WHATSAPP_EVENT_TEMPLATES[event].previews,
      simulatedPayloads: {
        en: buildWhatsAppTemplatePayload({ to: "+15550000000", event, locale: "en" }),
        ar: buildWhatsAppTemplatePayload({ to: "+15550000000", event, locale: "ar" }),
      },
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}
