import { NextRequest } from "next/server";
import type { UserRole } from "@/types/academy";
import { getCurrentSessionUser } from "@/lib/auth";

type AdminIdentity = {
  role: UserRole;
  actor: string;
};

export async function resolveAdminIdentity(request: NextRequest): Promise<AdminIdentity> {
  const configuredKey = process.env.ADMIN_ACCESS_KEY;
  const requestKey = request.headers.get("x-admin-key");
  if (configuredKey && requestKey !== configuredKey) {
    throw new Error("Unauthorized admin access.");
  }

  const user = await getCurrentSessionUser();
  if (!user || user.role !== "admin") {
    throw new Error("Unauthorized admin access.");
  }

  const roleHeader = request.headers.get("x-admin-role");
  const role: UserRole = roleHeader === "editor" || roleHeader === "instructor" || roleHeader === "student" ? roleHeader : "admin";
  const actor = request.headers.get("x-admin-actor") || user.email;
  return { role, actor };
}

export function adminErrorStatus(error: unknown, fallbackStatus = 400) {
  if (error instanceof Error && error.message === "Unauthorized admin access.") {
    return 401;
  }
  return fallbackStatus;
}
