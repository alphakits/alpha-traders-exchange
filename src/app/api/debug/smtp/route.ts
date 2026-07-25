import { NextResponse } from "next/server";

export async function GET() {
  const smtpHost = process.env.SMTP_HOST ?? "";
  const smtpPort = process.env.SMTP_PORT ?? "";
  const smtpUser = process.env.SMTP_USER ?? "";
  const smtpPass = process.env.SMTP_PASS ?? "";
  const smtpSecure = process.env.SMTP_SECURE ?? "";

  return NextResponse.json(
    {
      smtpHostExists: Boolean(smtpHost),
      smtpHost: smtpHost || null,
      smtpPort: smtpPort || null,
      smtpUser: smtpUser || null,
      smtpPassExists: Boolean(smtpPass),
      smtpPassLength: smtpPass.length,
      smtpSecure: smtpSecure || null,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
