const EXCHANGE_ROUTES = [
  "/market", "/trade", "/news", "/usdt-exchange", "/exchange", "/trade-room",
  "/profile", "/settings", "/notifications", "/seller-application", "/dashboard/seller",
  "/admin/alpha-exchange",
];

export function isAlphaExchangePath(pathname: string) {
  const path = pathname.replace(/^\/(ar|en)(?=\/|$)/, "") || "/";
  return path === "/dashboard" || EXCHANGE_ROUTES.some((route) => path === route || path.startsWith(`${route}/`));
}

export function exchangeNavigation(locale: "ar" | "en") {
  return [
    { href: "/market", label: locale === "ar" ? "السوق" : "Market" },
    { href: "/trade", label: locale === "ar" ? "التداول" : "Trade" },
    { href: "/news", label: locale === "ar" ? "الأخبار" : "News" },
    { href: "/settings", label: locale === "ar" ? "الإعدادات" : "Settings" },
  ];
}
