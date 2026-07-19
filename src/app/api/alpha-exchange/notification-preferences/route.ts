import { NextRequest, NextResponse } from "next/server";
import { updateNotificationPreferences } from "@/lib/alpha-exchange-store";
import { requireApiUser } from "@/lib/api-auth";

export async function GET() {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  return NextResponse.json({
    preferences: {
      inApp: user.notificationPreferences?.inApp !== false,
      email: user.notificationPreferences?.email === true,
      sms: user.notificationPreferences?.sms === true,
    },
  });
}

export async function PATCH(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;

  try {
    const body = await request.json();
    const preferences = await updateNotificationPreferences({
      userId: user.id,
      preferences: {
        inApp: typeof body.inApp === "boolean" ? body.inApp : undefined,
        email: typeof body.email === "boolean" ? body.email : undefined,
        sms: typeof body.sms === "boolean" ? body.sms : undefined,
      },
    });
    return NextResponse.json({ preferences });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update notification preferences." }, { status: 400 });
  }
}
