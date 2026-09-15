import { NextRequest, NextResponse } from "next/server";
import {
  deleteNotification,
  markNotificationReadState,
  sanitizeNotificationForClient,
  updateNotificationState,
} from "@/lib/alpha-exchange-store";
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
    const body = await request.json() as { action?: unknown; isRead?: unknown; state?: unknown };
    const validationMs = Date.now() - validationStartedAt;
    const logicStartedAt = Date.now();
    const shouldArchive = body.action === "dismiss" || body.state === "archived";
    if (!shouldArchive && typeof body.isRead !== "boolean") {
      return NextResponse.json({ error: "Invalid notification action." }, { status: 400 });
    }
    const notification = shouldArchive
      ? await updateNotificationState({ userId: user.id, notificationId, state: "archived" })
      : await markNotificationReadState({
          userId: user.id,
          notificationId,
          isRead: body.isRead as boolean,
        });
    const logicMs = Date.now() - logicStartedAt;
    const routeMs = Date.now() - routeStartedAt;
    return NextResponse.json({ notification: sanitizeNotificationForClient(notification) }, {
      headers: {
        "Cache-Control": "private, no-store",
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
