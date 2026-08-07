import { NextResponse } from "next/server";
import { getMarketplacePulse, touchUserPresence } from "@/lib/alpha-exchange-store";
import { requireApiUser } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// Authenticated live marketplace pulse. Touching presence here lets us count
// genuinely-online buyers and sellers from real active sessions (throttled so
// it does not write on every poll). All returned values are real and
// privacy-safe — no buyer names, amounts, wallets, emails, or private details.
export async function GET() {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;

  await touchUserPresence(user.id);
  const pulse = await getMarketplacePulse();

  return NextResponse.json(pulse, { headers: { "Cache-Control": "no-store" } });
}
