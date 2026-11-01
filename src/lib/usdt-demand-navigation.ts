import { getInterfaceAccess } from "@alpha-traders/contracts";

type RequestNavigationUser = NonNullable<Parameters<typeof getInterfaceAccess>[0]> & {
  emailVerified?: boolean;
  isPhotoVerified?: boolean;
  adultConfirmed?: boolean;
};

/** One destination policy for the menu, welcome dashboard and marketplace. */
export function buyRequestsDestination(user: RequestNavigationUser | null | undefined, enabled: boolean): string | null {
  if (!enabled || !user || user.emailVerified !== true || user.isPhotoVerified !== true || user.adultConfirmed !== true) return null;
  const access = getInterfaceAccess(user);
  if (!access.buyer && !access.canSell) return null;
  return `/usdt-exchange/requests?scope=${access.canSell ? "available" : "mine"}`;
}
