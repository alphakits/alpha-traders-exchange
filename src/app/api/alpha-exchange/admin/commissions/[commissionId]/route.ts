import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { updateCommissionPaymentStatus } from "@/lib/alpha-exchange-store";

type RouteContext = {
  params: Promise<{ commissionId: string }>;
};

function isValidPaymentStatus(value: string): value is "pending" | "paid" | "overdue" {
  return value === "pending" || value === "paid" || value === "overdue";
}

function isValidPaymentVerificationStatus(value: unknown): value is "pending_verification" | "verified" | "failed" {
  return value === "pending_verification" || value === "verified" || value === "failed";
}

const MAX_ADMIN_PAYMENT_NOTE_LENGTH = 500;

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;

  try {
    const { commissionId } = await context.params;
    const body = await request.json() as {
      paymentStatus?: unknown;
      paymentVerificationStatus?: unknown;
      paymentVerificationNotes?: unknown;
      reason?: unknown;
    };
    const paymentStatus = typeof body.paymentStatus === "string" ? body.paymentStatus.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    const paymentVerificationNotes = typeof body.paymentVerificationNotes === "string"
      ? body.paymentVerificationNotes.trim()
      : undefined;
    const paymentVerificationStatus = body.paymentVerificationStatus;
    if (!isValidPaymentStatus(paymentStatus)) {
      return NextResponse.json({ error: "Invalid commission status." }, { status: 400 });
    }
    if (!reason) {
      return NextResponse.json({ error: "Reason is required." }, { status: 400 });
    }
    if (reason.length > MAX_ADMIN_PAYMENT_NOTE_LENGTH) {
      return NextResponse.json({ error: "Reason must be 500 characters or fewer." }, { status: 400 });
    }
    if (body.paymentVerificationNotes !== undefined && typeof body.paymentVerificationNotes !== "string") {
      return NextResponse.json({ error: "Invalid payment verification notes." }, { status: 400 });
    }
    if (paymentVerificationNotes && paymentVerificationNotes.length > MAX_ADMIN_PAYMENT_NOTE_LENGTH) {
      return NextResponse.json({ error: "Payment verification notes must be 500 characters or fewer." }, { status: 400 });
    }
    if (paymentVerificationStatus !== undefined && !isValidPaymentVerificationStatus(paymentVerificationStatus)) {
      return NextResponse.json({ error: "Invalid payment verification status." }, { status: 400 });
    }
    if (paymentStatus === "paid" && paymentVerificationStatus !== undefined && paymentVerificationStatus !== "verified") {
      return NextResponse.json({ error: "A paid commission must have verified payment status." }, { status: 400 });
    }
    if (paymentStatus !== "paid" && paymentVerificationStatus === "verified") {
      return NextResponse.json({ error: "Only a paid commission can have verified payment status." }, { status: 400 });
    }

    const commission = await updateCommissionPaymentStatus({
      commissionId,
      actorUserId: user.id,
      paymentStatus,
      paymentVerificationStatus,
      paymentVerificationNotes,
      reason,
    });
    return NextResponse.json({ commission });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update commission." }, { status: 400 });
  }
}
