import { NextResponse } from "next/server";
import { getCurrentSessionUser } from "@/lib/auth";
import { hasRole } from "@/lib/roles";

// Dev-only debug endpoint — returns current session user with role diagnostics.
// Remove before production deployment.
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const user = await getCurrentSessionUser();
  if (!user) {
    return NextResponse.json({
      authenticated: false,
      user: null,
      diagnostics: {
        isApprovedSeller: false,
        isAdmin: false,
        reason: "No active session — cookie missing, expired, or user not found.",
      },
    });
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      roles: user.roles ?? [],
      sellerStatus: user.sellerStatus,
      emailVerified: user.emailVerified,
    },
    diagnostics: {
      isApprovedSeller: hasRole(user, "approved_seller"),
      isAdmin: hasRole(user, "admin"),
      roleCheck: user.role === "approved_seller",
      sellerStatusCheck: user.sellerStatus === "approved_seller",
      rolesArrayCheck: (user.roles ?? []).includes("approved_seller"),
      strictAndCheck: user.role === "approved_seller" && user.sellerStatus === "approved_seller",
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
