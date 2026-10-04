export type InterfaceSessionUser = {
  role: string;
  roles?: readonly string[];
  sellerStatus?: string;
};

/** Display rules only. Server routes must still authorize every request. */
export function getInterfaceAccess(user: InterfaceSessionUser | null | undefined) {
  const roles = user ? [user.role, ...(user.roles ?? [])] : [];
  const owner = roles.includes("owner");
  const administration = owner || roles.includes("admin");
  // Canonical seller status wins over old approved_seller role labels.
  const approvedSeller = user?.sellerStatus === "approved_seller";
  const suspendedSeller = user?.sellerStatus === "suspended";
  const pendingSeller = user?.sellerStatus === "pending_seller_approval";
  // Non-sellers also carry sellerStatus=buyer; that marker is not a buyer role.
  const buyer = roles.includes("buyer");
  const sellerWorkspace = approvedSeller || suspendedSeller;
  const trading = administration || buyer || sellerWorkspace || pendingSeller;
  const canApplyToSell = buyer && !administration && !sellerWorkspace && !pendingSeller;
  return {
    authenticated: Boolean(user),
    owner,
    administration,
    approvedSeller,
    sellerWorkspace,
    pendingSeller,
    buyer,
    student: roles.includes("student"),
    trading,
    canSell: administration || approvedSeller,
    canApplyToSell,
    dashboardHref: administration ? "/admin/alpha-exchange"
      : sellerWorkspace ? "/dashboard/seller"
        : trading ? "/dashboard" : "/profile",
  };
}

export function canShowInterfaceLink(href: string, user: InterfaceSessionUser | null | undefined) {
  const access = getInterfaceAccess(user);
  const path = href.split(/[?#]/, 1)[0].replace(/^\/(?:ar|en)(?=\/|$)/, "");
  if (/^\/(?:login|register)(?:\/|$)/.test(path)) return !access.authenticated;
  if (/^\/admin(?:\/|$)/.test(path)) return access.administration;
  if (/^\/dashboard\/seller(?:\/|$)/.test(path)) return access.sellerWorkspace && !access.administration;
  if (/^\/dashboard(?:\/|$)/.test(path)) return access.trading;
  if (/^\/(?:trades|trade-room)(?:\/|$)/.test(path)) return access.trading;
  if (path === "/usdt-exchange") {
    if (/[?&]mode=sell(?:[&#]|$)/.test(href) || /#create-listing(?:$|[?&])/.test(href)) return access.canSell;
    return !/[?#]/.test(href) || access.authenticated;
  }
  if (/^\/(?:profile|settings|notifications|academy|lessons|prop-firms|news|learn-with-mark)(?:\/|$)/.test(path)) return access.authenticated;
  if (path === "/start") return !access.authenticated;
  return true;
}

/** Role-only route guard; authentication and phone gates run separately. */
export function getInterfacePageDestination(user: InterfaceSessionUser, pathname: string, locale: "ar" | "en") {
  const access = getInterfaceAccess(user);
  const path = pathname.split(/[?#]/, 1)[0].replace(/^\/(?:ar|en)(?=\/|$)/, "");
  if (/^\/admin(?:\/|$)/.test(path) && !access.administration) return `/${locale}${access.dashboardHref}`;
  if (/^\/dashboard\/seller(?:\/|$)/.test(path) && !access.sellerWorkspace && !access.administration) return `/${locale}${access.dashboardHref}`;
  if (path === "/dashboard" && !access.trading) return `/${locale}/profile`;
  return null;
}
