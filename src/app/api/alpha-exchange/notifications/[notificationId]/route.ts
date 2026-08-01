import { NextRequest, NextResponse } from "next/server";
import { deleteNotification, markNotificationReadState } from "@/lib/alpha-exchange-store";
import { requireApiUser } from "@/lib/api-auth";

type RouteContext = {
  params: Promise<{ notificationId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const routeStartedAt = Date.now();
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;

  try {
    const { notificationId } = await context.params;
    const validationStartedAt = Date.now();
    const body = await request.json();
    const isRead = body.isRead === true;
    const validationMs = Date.now() - validationStartedAt;
    const logicStartedAt = Date.now();
    const notification = await markNotificationReadState({
      userId: user.id,
      notificationId,
      isRead,
    });
    const logicMs = Date.now() - logicStartedAt;
    const routeMs = Date.now() - routeStartedAt;
    return NextResponse.json({ notification }, {
      headers: {
        "X-Trade-Route-Ms": String(routeMs),
        "X-Trade-Validation-Ms": String(validationMs),
        "X-Trade-Logic-Ms": String(logicMs),
        "Server-Timing": `route;dur=${routeMs}, validate;dur=${validationMs}, logic;dur=${logicMs}`,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update notification." }, { status: 400 });
  }
}

export async function DELETE(_: NextRequest, context: RouteContext) {
  const routeStartedAt = Date.now();
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;

  try {
    const { notificationId } = await context.params;
    const logicStartedAt = Date.now();
    await deleteNotification({
      userId: user.id,
      notificationId,
    });
    const logicMs = Date.now() - logicStartedAt;
    const routeMs = Date.now() - routeStartedAt;
    return NextResponse.json({ success: true }, {
      headers: {
        "X-Trade-Route-Ms": String(routeMs),
        "X-Trade-Logic-Ms": String(logicMs),
        "Server-Timing": `route;dur=${routeMs}, logic;dur=${logicMs}`,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to delete notification." }, { status: 400 });
  }
}
