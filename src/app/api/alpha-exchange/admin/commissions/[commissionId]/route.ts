import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { updateCommissionPaymentStatus } from "@/lib/alpha-exchange-store";

type RouteContext = {
  params: Promise<{ commissionId: string }>;
};

function isValidPaymentStatus(value: string): value is "pending" | "paid" | "overdue" {
  return value === "pending" || value === "paid" || value === "overdue";
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;

  try {
    const { commissionId } = await context.params;
    const body = await request.json();
    const paymentStatus = String(body.paymentStatus ?? "").trim();
    if (!isValidPaymentStatus(paymentStatus)) {
      return NextResponse.json({ error: "Invalid commission status." }, { status: 400 });
    }

    const commission = await updateCommissionPaymentStatus({
      commissionId,
      actorUserId: user.id,
      paymentStatus,
    });
    return NextResponse.json({ commission });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update commission." }, { status: 400 });
  }
}
