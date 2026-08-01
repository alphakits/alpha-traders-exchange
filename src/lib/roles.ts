import { isAlphaExchangeOwnerEmail } from "@/lib/alpha-exchange-identity";
import type { AlphaExchangeUser, UserRole } from "@/types/alpha-exchange";

export const ROLE_PRIORITY: UserRole[] = [
  "owner",
  "admin",
  "approved_seller",
  "pending_seller_approval",
  "buyer",
  "student",
  "guest",
];

export function isUserRole(value: string): value is UserRole {
  return ROLE_PRIORITY.includes(value as UserRole);
}

export function dedupeRoles(roles: UserRole[]) {
  return Array.from(new Set(roles));
}

export function resolvePrimaryRole(roles: UserRole[]) {
  for (const role of ROLE_PRIORITY) {
    if (roles.includes(role)) return role;
  }
  return "guest";
}

export function normalizeRolesForUser(input: {
  email: string;
  roles?: UserRole[];
  role?: UserRole;
  sellerStatus?: string;
}) {
  const roles = [...(input.roles ?? [])];
  if (input.role && isUserRole(input.role)) roles.push(input.role);
  if (input.sellerStatus === "approved_seller") roles.push("approved_seller");
  if (input.sellerStatus === "pending_seller_approval") roles.push("pending_seller_approval");

  if (roles.length === 0) roles.push("guest");

  if (isAlphaExchangeOwnerEmail(input.email)) {
    roles.push("owner", "admin");
  }
  return dedupeRoles(roles.filter(isUserRole));
}

export function hasRole(user: Pick<AlphaExchangeUser, "role" | "roles" | "sellerStatus">, role: UserRole) {
  if (role === "approved_seller") {
    return user.sellerStatus === "approved_seller" || user.role === "approved_seller" || (user.roles ?? []).includes("approved_seller");
  }
  if (role === "pending_seller_approval") {
    return user.sellerStatus === "pending_seller_approval" || (user.roles ?? []).includes("pending_seller_approval");
  }
  if (role === "buyer") {
    return user.sellerStatus === "buyer" || user.role === "buyer" || (user.roles ?? []).includes("buyer");
  }
  return user.role === role || (user.roles ?? []).includes(role);
}

export function addRole(roles: UserRole[], role: UserRole) {
  if (roles.includes(role)) return roles;
  return [...roles, role];
}

export function removeRole(roles: UserRole[], role: UserRole) {
  return roles.filter((item) => item !== role);
}
