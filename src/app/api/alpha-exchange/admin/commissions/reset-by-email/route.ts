import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import {
  findUserByEmail,
  getCommissionRecordsForAdmin,
  updateCommissionPaymentStatus,
} from "@/lib/alpha-exchange-store";

export async function POST(request: NextRequest) {
  const { user: admin, unauthorized } = await requireApiAdmin();
  if (!admin) return unauthorized;

  try {
    const body = await request.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ error: "email is required." }, { status: 400 });
    }

    const seller = await findUserByEmail(email);
    if (!seller) {
      return NextResponse.json({ error: `No user found with email: ${email}.` }, { status: 404 });
    }

    const allRecords = await getCommissionRecordsForAdmin();
    const pending = allRecords.filter(
      (r) => r.sellerId === seller.id && r.paymentStatus !== "paid",
    );

    for (const record of pending) {
      await updateCommissionPaymentStatus({
        commissionId: record.id,
        actorUserId: admin.id,
        paymentStatus: "paid",
      });
    }

    return NextResponse.json({
      sellerId: seller.id,
      sellerEmail: seller.email,
      clearedCount: pending.length,
      message: `Cleared ${pending.length} commission record(s) for ${email}.`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to reset commissions." },
      { status: 500 },
    );
  }
}
