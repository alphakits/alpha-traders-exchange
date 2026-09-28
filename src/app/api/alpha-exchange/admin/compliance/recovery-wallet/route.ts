import { NextRequest, NextResponse } from "next/server";
import { requireApiOwner } from "@/lib/api-auth";
import { updateOwnerMarketplaceComplianceRecoveryWallet } from "@/lib/alpha-exchange-store";
import type { CompliancePaymentRail, SupportedNetwork } from "@/types/alpha-exchange";

function isSupportedNetwork(value: string): value is SupportedNetwork {
  return value === "TRC20" || value === "ERC20" || value === "BEP20" || value === "SOL";
}

export async function POST(request: NextRequest) {
  const { user, unauthorized } = await requireApiOwner();
  if (!user) return unauthorized;

  try {
    const body = (await request.json()) as {
      network?: string;
      walletAddress?: string;
      defaultPaymentRail?: CompliancePaymentRail;
    };
    const network = String(body.network ?? "").trim();
    if (!isSupportedNetwork(network)) {
      return NextResponse.json({ error: "Unsupported wallet network." }, { status: 400 });
    }

    const config = await updateOwnerMarketplaceComplianceRecoveryWallet({
      actorUserId: user.id,
      network,
      walletAddress: String(body.walletAddress ?? ""),
      defaultPaymentRail: body.defaultPaymentRail,
    });

    return NextResponse.json({ config });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update Marketplace Compliance Recovery Wallet." },
      { status: 400 },
    );
  }
}
