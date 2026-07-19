import { NextRequest, NextResponse } from "next/server";
import { deleteNotification, markNotificationReadState } from "@/lib/alpha-exchange-store";
import { requireApiUser } from "@/lib/api-auth";

type RouteContext = {
  params: Promise<{ notificationId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;

  try {
    const { notificationId } = await context.params;
    const body = await request.json();
    const isRead = body.isRead === true;
    const notification = await markNotificationReadState({
      userId: user.id,
      notificationId,
      isRead,
    });
    return NextResponse.json({ notification });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update notification." }, { status: 400 });
  }
}

export async function DELETE(_: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;

  try {
    const { notificationId } = await context.params;
    await deleteNotification({
      userId: user.id,
      notificationId,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to delete notification." }, { status: 400 });
  }
}
