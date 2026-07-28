import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { grantStudentRole } from "@/lib/alpha-exchange-store";

export async function POST() {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const updated = await grantStudentRole(user.id);
  return NextResponse.json({
    ok: true,
    user: {
      id: updated.id,
      role: updated.role,
      roles: updated.roles ?? [updated.role],
    },
  });
}
