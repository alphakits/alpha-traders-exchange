import Link from "next/link";
import type { AppLocale } from "@/i18n/routing";

type BreadcrumbItem = { name: string; item: string };

/** Render the same server-owned items used by the page's BreadcrumbList schema. */
export function PublicDiscoveryBreadcrumbs({
  locale,
  items,
}: {
  locale: AppLocale;
  items: ReadonlyArray<BreadcrumbItem>;
}) {
  if (items.length === 0) return null;

  return (
    <nav aria-label={locale === "ar" ? "مسار التصفح" : "Breadcrumb"} dir={locale === "ar" ? "rtl" : "ltr"}>
      <ol className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[#9CA3AF]">
        {items.map((item, index) => (
          <li key={item.item} className="flex min-w-0 items-center gap-2">
            {index > 0 ? <span aria-hidden="true">/</span> : null}
            {index === items.length - 1 ? (
              <span aria-current="page" className="inline-flex min-h-11 items-center break-words text-[#D1D5DB]">{item.name}</span>
            ) : (
              <Link href={item.item} className="inline-flex min-h-11 items-center rounded-md hover:text-[#F4D978] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227]">
                {item.name}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
