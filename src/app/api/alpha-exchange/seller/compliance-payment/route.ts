import { NextRequest, NextResponse } from "next/server";
import {
  getSellerMarketplaceEnforcementStatus,
  submitMarketplaceEnforcementAppealBySeller,
  submitMarketplaceEnforcementPaymentBySeller,
} from "@/lib/alpha-exchange-store";
import { requireApiSellerWorkspaceActor } from "@/lib/api-auth";

export async function GET() {
  const { user, unauthorized } = await requireApiSellerWorkspaceActor();
  if (!user) return unauthorized;

  const enforcement = await getSellerMarketplaceEnforcementStatus(user.id);
  return NextResponse.json({ enforcement });
}

export async function POST(request: NextRequest) {
  const { user, unauthorized } = await requireApiSellerWorkspaceActor();
  if (!user) return unauthorized;

  try {
    const body = (await request.json()) as {
      action?: string;
      note?: string;
      appealMessage?: string;
    };

    const action = String(body.action ?? "").trim();
    if (action === "submit_payment") {
      const enforcement = await submitMarketplaceEnforcementPaymentBySeller({
        sellerId: user.id,
        note: typeof body.note === "string" ? body.note : undefined,
      });
      return NextResponse.json({ enforcement });
    }

    if (action === "submit_appeal") {
      const enforcement = await submitMarketplaceEnforcementAppealBySeller({
        sellerId: user.id,
        message: String(body.appealMessage ?? "").trim(),
      });
      return NextResponse.json({ enforcement });
    }

    return NextResponse.json({ error: "Invalid compliance payment action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process compliance payment action." },
      { status: 400 },
    );
  }
}
