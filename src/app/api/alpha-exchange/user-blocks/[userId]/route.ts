import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { getUserBlockStatus, setUserBlockStatus } from "@/lib/alpha-exchange-store";
import { checkSharedRateLimit } from "@/lib/rate-limit";

type RouteContext = {
  params: Promise<{ userId: string }>;
};

const USER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

async function resolveActors(context: RouteContext) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return { user: null, targetUserId: "", response: unauthorized };
  const { userId } = await context.params;
  const targetUserId = userId.trim();
  if (!USER_ID_PATTERN.test(targetUserId) || targetUserId === user.id) {
    return {
      user: null,
      targetUserId: "",
      response: NextResponse.json({ error: "Invalid target account." }, { status: 400 }),
    };
  }
  return { user, targetUserId, response: null };
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const resolved = await resolveActors(context);
  if (!resolved.user) return resolved.response;
  try {
    return NextResponse.json(
      await getUserBlockStatus({ actorUserId: resolved.user.id, targetUserId: resolved.targetUserId }),
      { status: 200, headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to read block status." }, { status: 404 });
  }
}

async function changeBlockStatus(request: NextRequest, context: RouteContext, blocked: boolean) {
  const resolved = await resolveActors(context);
  if (!resolved.user) return resolved.response;
  const rate = await checkSharedRateLimit({
    headers: request.headers,
    key: "exchange:user-block",
    maxRequests: 30,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many account-safety changes. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }
  try {
    const result = await setUserBlockStatus({
      actorUserId: resolved.user.id,
      targetUserId: resolved.targetUserId,
      blocked,
    });
    return NextResponse.json(result, { status: 200, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to change block status." }, { status: 400 });
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return changeBlockStatus(request, context, true);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return changeBlockStatus(request, context, false);
}
