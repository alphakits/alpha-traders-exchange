import { NextRequest } from "next/server";
import type { UserRole } from "@/types/academy";

type AdminIdentity = {
  role: UserRole;
  actor: string;
};

export function resolveAdminIdentity(request: NextRequest): AdminIdentity {
  const configuredKey = process.env.ADMIN_ACCESS_KEY;
  const requestKey = request.headers.get("x-admin-key");
  if (configuredKey && requestKey !== configuredKey) {
    throw new Error("Unauthorized admin access.");
  }

  const roleHeader = request.headers.get("x-admin-role");
  const role: UserRole = roleHeader === "editor" || roleHeader === "instructor" || roleHeader === "student" ? roleHeader : "admin";
  const actor = request.headers.get("x-admin-actor") || "local-admin";
  return { role, actor };
}
