import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { disableQaAccountsByEmails, provisionQaAccount } from "@/lib/alpha-exchange-store";
import { hashPassword } from "@/lib/auth";

function isProvisioningEnabled() {
  return process.env.QA_PROVISION_ENABLED === "1" && Boolean(process.env.QA_PROVISION_SECRET);
}

function assertSecret(request: NextRequest) {
  const expected = process.env.QA_PROVISION_SECRET ?? "";
  const incoming = request.headers.get("x-qa-provision-secret") ?? "";
  return expected && incoming && expected === incoming;
}

function qaEmail(batchId: string, roleKey: string) {
  return `qa.${batchId}.${roleKey}@alphatraders.co.il`;
}

export async function POST(request: NextRequest) {
  if (!isProvisioningEnabled()) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (!assertSecret(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const body = await request.json();
    const action = String(body?.action ?? "create");
    const batchId = String(body?.batchId ?? new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)).toLowerCase();

    if (action === "cleanup") {
      const emails = Array.isArray(body?.emails)
        ? body.emails.map((value: unknown) => String(value).trim().toLowerCase()).filter(Boolean)
        : [];
      if (!emails.length) {
        return NextResponse.json({ error: "emails[] is required for cleanup." }, { status: 400 });
      }
      const result = await disableQaAccountsByEmails(emails);
      return NextResponse.json({ ok: true, action: "cleanup", ...result });
    }

    if (action !== "create") {
      return NextResponse.json({ error: "Invalid action." }, { status: 400 });
    }

    const defaultPhone = "+972501111111";
    const templates = [
      { key: "guest", fullName: "QA Guest", roles: ["guest"] as const, sellerStatus: "buyer" as const, onboardingSelection: "guest" as const },
      { key: "buyer", fullName: "QA Buyer", roles: ["buyer"] as const, sellerStatus: "buyer" as const, onboardingSelection: "buyer" as const, verifiedPhone: defaultPhone },
      { key: "seller-applicant", fullName: "QA Seller Applicant", roles: ["buyer", "pending_seller_approval"] as const, sellerStatus: "pending_seller_approval" as const, onboardingSelection: "seller_applicant" as const, verifiedPhone: defaultPhone },
      { key: "approved-seller", fullName: "QA Approved Seller", roles: ["buyer", "approved_seller"] as const, sellerStatus: "approved_seller" as const, onboardingSelection: "seller_applicant" as const, verifiedPhone: defaultPhone },
      { key: "admin", fullName: "QA Admin", roles: ["admin"] as const, sellerStatus: "buyer" as const, onboardingSelection: "guest" as const },
      { key: "owner", fullName: "QA Owner", roles: ["owner", "admin"] as const, sellerStatus: "buyer" as const, onboardingSelection: "guest" as const },
    ];

    const accounts: Array<{ role: string; email: string; password: string; userId: string; sellerStatus: string }> = [];
    for (const template of templates) {
      const email = qaEmail(batchId, template.key);
      const password = `Qa!${batchId}${template.key}${randomUUID().slice(0, 6)}`;
      const passwordHash = await hashPassword(password);
      const user = await provisionQaAccount({
        email,
        fullName: template.fullName,
        whatsappNumber: defaultPhone,
        passwordHash,
        roles: [...template.roles],
        sellerStatus: template.sellerStatus,
        onboardingSelection: template.onboardingSelection,
        verifiedPhone: template.verifiedPhone,
      });
      accounts.push({
        role: template.key,
        email,
        password,
        userId: user.id,
        sellerStatus: user.sellerStatus,
      });
    }

    return NextResponse.json({
      ok: true,
      action: "create",
      batchId,
      accounts,
      cleanup: {
        action: "cleanup",
        emails: accounts.map((account) => account.email),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process QA provisioning request." },
      { status: 400 },
    );
  }
}
