import Image from "next/image";
import { notFound } from "next/navigation";
import { buildPageMetadata } from "@/lib/seo";
import { getCurrentSessionUser } from "@/lib/auth";
import { getPublicUserProfileRouteData } from "@/lib/alpha-exchange-store";

export async function generateMetadata({ params }: { params: Promise<{ locale: string; username: string }> }) {
  const { locale, username } = await params;
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? `الملف العام • ${username}` : `Public Profile • ${username}`,
    description: locale === "ar" ? "الملف العام لمستخدم Alpha Traders." : "Public profile for an Alpha Traders user.",
    path: `/u/${username}`,
  });
}

export default async function PublicUserProfilePage({
  params,
}: {
  params: Promise<{ locale: string; username: string }>;
}) {
  const { locale, username } = await params;
  const isAr = locale === "ar";
  const viewer = await getCurrentSessionUser();
  const data = await getPublicUserProfileRouteData({
    username,
    viewerUserId: viewer?.id,
    viewerRole: viewer?.role,
  });
  if (!data) notFound();

  const initials = data.profile.fullName?.trim()?.charAt(0)?.toUpperCase() || "?";
  const level = data.reputation?.level ?? null;

  return (
    <section className="section-container page-shell">
      <div className="surface-panel mx-auto w-full max-w-5xl overflow-hidden p-0">
        <div className="relative h-44 border-b border-white/10 bg-gradient-to-r from-black via-[#1B1403] to-black">
          {data.profile.coverBannerUrl ? (
            <Image src={data.profile.coverBannerUrl} alt={data.profile.fullName} fill sizes="(max-width: 768px) 100vw, 1024px" className="object-cover opacity-90" priority />
          ) : null}
        </div>
        <div className="p-6 md:p-8">
          <div className="-mt-16 mb-5 flex flex-wrap items-end gap-4">
            <div className="h-24 w-24 overflow-hidden rounded-2xl border border-[#C9A227]/35 bg-black/60 shadow-[0_12px_32px_rgba(0,0,0,0.35)]">
              {data.profile.profilePhotoUrl ? (
                <Image src={data.profile.profilePhotoUrl} alt={data.profile.fullName} width={96} height={96} sizes="96px" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-2xl font-semibold text-[#F4D87A]">{initials}</div>
              )}
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-white md:text-3xl">{data.profile.fullName}</h1>
              <p className="mt-1 text-sm text-[#9CA3AF]">@{data.profile.username}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                {level ? (
                  <span className="rounded-full border border-[#C9A227]/30 bg-[#C9A227]/10 px-2.5 py-1 text-[#F4D87A]">
                    {isAr ? "المستوى" : "Level"}: {level}
                  </span>
                ) : null}
                {data.profile.isFoundingMember ? (
                  <span className="rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[#D1D5DB]">{isAr ? "عضو مؤسس" : "Founding Member"}</span>
                ) : null}
                {data.profile.isFeaturedSeller ? (
                  <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1 text-emerald-300">{isAr ? "بائع مميز" : "Featured Seller"}</span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            <div className="md:col-span-2">
              <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#C9A227]">{isAr ? "نبذة" : "About"}</h2>
              <p className="mt-3 text-sm leading-7 text-[#D1D5DB]">
                {data.profile.bio || (isAr ? "لا توجد نبذة حالياً." : "No bio available yet.")}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
              <h3 className="text-sm font-semibold text-white">{isAr ? "معلومات الملف" : "Profile details"}</h3>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex items-center justify-between gap-2"><dt className="text-[#9CA3AF]">{isAr ? "الدولة" : "Country"}</dt><dd className="text-[#D1D5DB]">{data.profile.country || "—"}</dd></div>
                <div className="flex items-center justify-between gap-2"><dt className="text-[#9CA3AF]">{isAr ? "المدينة" : "City"}</dt><dd className="text-[#D1D5DB]">{data.profile.city || "—"}</dd></div>
                <div className="flex items-center justify-between gap-2"><dt className="text-[#9CA3AF]">{isAr ? "اللغات" : "Languages"}</dt><dd className="text-[#D1D5DB]">{data.profile.languages.join(", ") || "—"}</dd></div>
                <div className="flex items-center justify-between gap-2"><dt className="text-[#9CA3AF]">{isAr ? "البريد" : "Email"}</dt><dd className="text-[#D1D5DB]">{data.profile.contact.email || "—"}</dd></div>
                <div className="flex items-center justify-between gap-2"><dt className="text-[#9CA3AF]">{isAr ? "الهاتف" : "Phone"}</dt><dd className="text-[#D1D5DB]">{data.profile.contact.phone || "—"}</dd></div>
              </dl>
            </div>
          </div>

          {data.stats ? (
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4"><p className="text-xs text-[#9CA3AF]">{isAr ? "صفقات مكتملة كمشتري" : "Completed as Buyer"}</p><p className="mt-1 text-xl font-semibold text-white">{data.stats.completedAsBuyer}</p></div>
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4"><p className="text-xs text-[#9CA3AF]">{isAr ? "صفقات مكتملة كبائع" : "Completed as Seller"}</p><p className="mt-1 text-xl font-semibold text-white">{data.stats.completedAsSeller}</p></div>
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4"><p className="text-xs text-[#9CA3AF]">{isAr ? "تقييمات مكتوبة" : "Reviews Written"}</p><p className="mt-1 text-xl font-semibold text-white">{data.stats.reviewsWritten}</p></div>
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4"><p className="text-xs text-[#9CA3AF]">{isAr ? "تقييمات مستلمة" : "Reviews Received"}</p><p className="mt-1 text-xl font-semibold text-white">{data.stats.reviewsReceived}</p></div>
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4"><p className="text-xs text-[#9CA3AF]">{isAr ? "إعلانات نشطة" : "Active Listings"}</p><p className="mt-1 text-xl font-semibold text-white">{data.stats.activeListings}</p></div>
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4"><p className="text-xs text-[#9CA3AF]">{isAr ? "إعلانات مسودة" : "Draft Listings"}</p><p className="mt-1 text-xl font-semibold text-white">{data.stats.pendingListings}</p></div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
