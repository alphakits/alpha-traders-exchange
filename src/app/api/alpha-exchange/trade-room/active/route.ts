import { NextResponse } from "next/server";
import { getFirstActiveTradeForUser } from "@/lib/alpha-exchange-store";
import { requireApiUser } from "@/lib/api-auth";

export async function GET() {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;

  const activeTrade = await getFirstActiveTradeForUser(user.id, user.role);
  return NextResponse.json({
    activeRequestId: activeTrade?.id ?? null,
  });
}

