"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BadgeCheck, Clock3, History, ShieldCheck, Star } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatListingId } from "@/lib/format-id";
import {
  marketplacePaymentMethodLabelsForLocale,
  spokenLanguageLabelForLocale,
} from "@/lib/marketplace-display-localization";
import type { MarketplaceListing, PurchaseRequest } from "@/types/alpha-exchange";

type Payload = {
  pendingListings: MarketplaceListing[];
  allListings: MarketplaceListing[];
  purchaseRequests: PurchaseRequest[];
};

export function OwnerPendingListingsDashboard({ locale = "en" }: { locale?: "ar" | "en" }) {
  const isArabic = locale === "ar";
  const t = useCallback((english: string, arabic: string) => isArabic ? arabic : english, [isArabic]);
  const sellerLevelLabel = useCallback((value: string) => {
    if (!isArabic) return value;
    return ({ bronze: "برونزي", silver: "فضي", gold: "ذهبي", diamond: "ماسي", elite: "نخبة" } as Record<string, string>)[value] ?? value;
  }, [isArabic]);
  const sellerStatusLabel = useCallback((value: string) => {
    if (!isArabic) return value;
    return ({ online: "متصل", offline: "غير متصل", away: "غير متاح مؤقتًا" } as Record<string, string>)[value] ?? value;
  }, [isArabic]);
  const listingPaymentMethodsLabel = useCallback((listing: MarketplaceListing) => {
    const labels = marketplacePaymentMethodLabelsForLocale(listing.paymentMethods, listing.paymentMethod, locale);
    return labels.length ? labels.join(isArabic ? "، " : ", ") : t("Not provided", "غير مذكور");
  }, [isArabic, locale, t]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [data, setData] = useState<Payload>({ pendingListings: [], allListings: [], purchaseRequests: [] });
  const [reasonByListingId, setReasonByListingId] = useState<Record<string, string>>({});
  const [selectedSellerId, setSelectedSellerId] = useState<string | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);

  const pushToast = useCallback((message: string) => {
    if (toastTimeoutRef.current !== null) {
      window.clearTimeout(toastTimeoutRef.current);
    }
    setToast(message);
    toastTimeoutRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimeoutRef.current = null;
    }, 1800);
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/alpha-exchange/admin/pending-listings", { cache: "no-store" });
      const json = (await response.json()) as Payload & { error?: string };
      if (!response.ok) throw new Error(isArabic ? "تعذّر تحميل العروض المعلّقة." : json.error || "Failed to load pending listings.");
      setData(json);
    } catch (requestError) {
      setError(isArabic ? "تعذّر تحميل العروض المعلّقة. حدّث الصفحة وحاول مجددًا." : requestError instanceof Error ? requestError.message : "Failed to load pending listings.");
    } finally {
      setLoading(false);
    }
  }, [isArabic]);

  useEffect(() => {
    void fetchData();
    return () => {
      if (toastTimeoutRef.current !== null) {
        window.clearTimeout(toastTimeoutRef.current);
      }
    };
  }, [fetchData]);

  async function runDecision(listingId: string, action: "approve" | "reject" | "request_changes") {
    const reason = reasonByListingId[listingId]?.trim() || "";
    if ((action === "reject" || action === "request_changes") && !reason) {
      pushToast(t("Reason is required for reject/request changes.", "السبب مطلوب عند الرفض أو طلب التعديلات."));
      return;
    }
    const response = await fetch(`/api/alpha-exchange/admin/listings/${listingId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, reason }),
    });
    const json = (await response.json()) as { error?: string };
    if (!response.ok) {
      pushToast(isArabic ? "تعذّر إكمال الإجراء. حاول مجددًا." : json.error || "Action failed.");
      return;
    }
    pushToast(action === "approve" ? t("Listing approved.", "تمت الموافقة على العرض.") : action === "reject" ? t("Listing rejected.", "تم رفض العرض.") : t("Changes requested.", "تم طلب التعديلات."));
    await fetchData();
  }

  const sellerHistory = useMemo(() => {
    if (!selectedSellerId) return null;
    const sellerListings = data.allListings.filter((listing) => listing.sellerId === selectedSellerId);
    const sellerRequests = data.purchaseRequests.filter((request) => request.sellerId === selectedSellerId);
    const completedTrades = sellerRequests.filter((request) => request.status === "completed").length;
    const pendingTrades = sellerRequests.filter((request) => request.status === "pending").length;
    const selectedListing = sellerListings[0];
    return {
      listing: selectedListing ?? null,
      sellerListings,
      completedTrades,
      pendingTrades,
    };
  }, [data.allListings, data.purchaseRequests, selectedSellerId]);

  return (
    <section dir={isArabic ? "rtl" : "ltr"} lang={locale} className="section-container page-shell">
      <Card className="border-white/10 bg-[#0B0B0B]/95">
        <CardHeader>
          <CardTitle>{t("Pending Listings (Owner Review)", "العروض المعلّقة (مراجعة المالك)")}</CardTitle>
          <CardDescription>{t("Only the owner can approve, reject, or request changes before listings go live.", "المالك وحده يستطيع الموافقة أو الرفض أو طلب تعديلات قبل نشر العرض.")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? <p className="text-sm text-[#9CA3AF]">{t("Loading pending listings...", "جارٍ تحميل العروض المعلّقة...")}</p> : null}
          {error ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-[#FDE68A]">{error}</div>
          ) : null}
          {!loading && !error && data.pendingListings.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-[#9CA3AF]">{t("No pending listings to review.", "لا توجد عروض معلّقة للمراجعة.")}</div>
          ) : null}

          {data.pendingListings.map((listing) => (
            <Card key={listing.id} className="border-white/10 bg-black/20">
              <CardContent className="space-y-4 p-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2 text-sm text-[#D1D5DB]">
                    <p className="text-base font-semibold text-white">{listing.sellerDisplayName}</p>
                    <p className="inline-flex items-center gap-2"><Star className="h-4 w-4 text-[#C9A227]" /> {t("Seller Rating:", "تقييم البائع:")} <span className="text-white">{listing.sellerReputation?.rating.toFixed(2) ?? "—"}</span></p>
                    <p>{t("Seller Trust Score:", "درجة ثقة البائع:")} <span className="text-white">{Math.round(listing.sellerReputation?.customerSatisfaction ?? 0)}%</span></p>
                    <p>{t("Seller Level:", "رتبة البائع:")} <span className="text-white capitalize">{sellerLevelLabel(listing.sellerReputation?.level ?? "bronze")}</span></p>
                    <p>{t("Lifetime Completed Trades:", "إجمالي الصفقات المكتملة:")} <span className="text-white">{(listing.sellerReputation?.completedTrades ?? 0).toLocaleString(isArabic ? "ar-IL" : "en-IL")}</span></p>
                    <p>{t("Amount:", "الكمية:")} <bdi dir="ltr" className="text-white">{listing.availableAmount}</bdi></p>
                    <p>{t("Price:", "السعر:")} <bdi dir="ltr" className="text-white">{listing.price}</bdi></p>
                    <p>{t("Currency:", "العملة:")} <bdi dir="ltr" className="text-white">{listing.currency || "ILS"}</bdi></p>
                    <p>{t("Network:", "الشبكة:")} <bdi dir="ltr" className="text-white">{listing.network}</bdi></p>
                    <p>{t("Payment Methods:", "طرق الدفع:")} <bdi dir="auto" className="text-white">{listingPaymentMethodsLabel(listing)}</bdi></p>
                    <p>{t("Seller Description:", "وصف البائع:")} <span className="text-white">{listing.sellerDescription || t("Not provided", "غير مذكور")}</span></p>
                  </div>
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      {(listing.photos?.length ? listing.photos : ["/images/brand/alpha-traders-logo.png"]).slice(0, 4).map((photo, index) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={`${listing.id}-photo-${index}`} src={photo} alt={t(`Listing ${formatListingId(listing.displayNumber, listing.id)} photo ${index + 1}`, `صورة ${index + 1} للعرض ${formatListingId(listing.displayNumber, listing.id)}`)} className="h-24 w-full rounded-lg border border-white/10 object-cover" />
                      ))}
                    </div>
                    <Input
                      value={reasonByListingId[listing.id] ?? ""}
                      onChange={(event) => setReasonByListingId((prev) => ({ ...prev, [listing.id]: event.target.value }))}
                      placeholder={t("Reason (required for reject/request changes)", "السبب (مطلوب للرفض أو طلب التعديلات)")}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" onClick={() => runDecision(listing.id, "approve")}><BadgeCheck className="h-4 w-4" />{t("Approve", "موافقة")}</Button>
                      <Button type="button" size="sm" variant="secondary" onClick={() => runDecision(listing.id, "reject")}><AlertTriangle className="h-4 w-4" />{t("Reject", "رفض")}</Button>
                      <Button type="button" size="sm" variant="secondary" onClick={() => runDecision(listing.id, "request_changes")}><Clock3 className="h-4 w-4" />{t("Request Changes", "طلب تعديلات")}</Button>
                      <Button type="button" size="sm" variant="secondary" onClick={() => setSelectedSellerId(listing.sellerId)}><ShieldCheck className="h-4 w-4" />{t("View Seller Profile", "عرض ملف البائع")}</Button>
                      <Button type="button" size="sm" variant="secondary" onClick={() => setSelectedSellerId(listing.sellerId)}><History className="h-4 w-4" />{t("View Seller History", "عرض سجل البائع")}</Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {sellerHistory ? (
            <Card className="border-white/10 bg-black/20">
              <CardHeader>
                <CardTitle className="text-lg">{t("Seller Profile & History", "ملف البائع وسجله")}</CardTitle>
                <CardDescription>{t("Review seller profile details and trading history before decision.", "راجع ملف البائع وسجل صفقاته قبل اتخاذ القرار.")}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm text-[#D1D5DB] md:grid-cols-2">
                <p>{t("Seller:", "البائع:")} <span className="text-white">{sellerHistory.listing?.sellerDisplayName ?? "—"}</span></p>
                <p>{t("Member Since:", "عضو منذ:")} <span className="text-white">{sellerHistory.listing?.sellerProfile?.memberSince ? new Date(sellerHistory.listing.sellerProfile.memberSince).getFullYear() : "—"}</span></p>
                <p>{t("Online Status:", "حالة الاتصال:")} <span className="text-white">{sellerStatusLabel(sellerHistory.listing?.sellerProfile?.onlineStatus ?? "offline")}</span></p>
                <p>{t("Languages:", "اللغات:")} <bdi dir="auto" className="text-white">{sellerHistory.listing?.sellerProfile?.languages.map((language) => spokenLanguageLabelForLocale(language, locale)).join(isArabic ? "، " : ", ") || "—"}</bdi></p>
                <p>{t("Total Listings:", "إجمالي العروض:")} <span className="text-white">{sellerHistory.sellerListings.length}</span></p>
                <p>{t("Completed Trades:", "الصفقات المكتملة:")} <span className="text-white">{sellerHistory.completedTrades}</span></p>
                <p>{t("Pending Requests:", "الطلبات المعلّقة:")} <span className="text-white">{sellerHistory.pendingTrades}</span></p>
              </CardContent>
            </Card>
          ) : null}
        </CardContent>
      </Card>
      {toast ? (
        <div className="fixed bottom-4 end-4 rounded-full border border-[#C9A227]/35 bg-[#0B0B0B]/95 px-4 py-2 text-sm text-[#F3D98B] shadow-xl">{toast}</div>
      ) : null}
    </section>
  );
}
