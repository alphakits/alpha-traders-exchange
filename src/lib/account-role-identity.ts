import { isAlphaExchangeOwnerEmail } from "@/lib/alpha-exchange-identity";
import { hasRole } from "@/lib/roles";
import type { ClientSessionUser } from "@/lib/client-session-user";

type IdentityUser = Pick<ClientSessionUser, "role" | "roles" | "email" | "sellerStatus" | "sellerApprovalVerified">;

/** Chooses display identity only; never grants permissions or changes seller approval. */
export function accountRoleIdentity(user: IdentityUser) {
  if (hasRole(user, "owner") || (hasRole(user, "admin") && isAlphaExchangeOwnerEmail(user.email))) return "owner" as const;
  if (hasRole(user, "admin")) return "administrator" as const;
  if (hasRole(user, "approved_seller")) return "approved_seller" as const;
  if (hasRole(user, "pending_seller_approval")) return "pending_seller" as const;
  const assignedRoles = [user.role, ...(user.roles ?? [])];
  if (assignedRoles.includes("buyer")) return "buyer" as const;
  if (assignedRoles.includes("student")) return "student" as const;
  return "guest" as const;
}
