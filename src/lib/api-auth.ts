import { NextResponse } from "next/server";
import { clearUserSession, getCurrentSessionToken, getCurrentSessionUser } from "@/lib/auth";
import { isAlphaExchangeOwnerEmail } from "@/lib/alpha-exchange-identity";

export async function requireApiUser() {
  const user = await getCurrentSessionUser();
  if (!user) {
    const token = await getCurrentSessionToken();
    await clearUserSession(token);
    return {
      user: null,
      unauthorized: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { user, unauthorized: null };
}

export async function requireApiAdmin() {
  const { user, unauthorized } = await requireApiUser();
  if (!user) {
    return { user: null, unauthorized };
  }
  if (user.role !== "admin" || !isAlphaExchangeOwnerEmail(user.email)) {
    return {
      user: null,
      unauthorized: NextResponse.json({ error: "Admin access required." }, { status: 403 }),
    };
  }
  return { user, unauthorized: null };
}
