"use client";

import { useRef, useState } from "react";
import { publicAccountId } from "@/lib/public-account-identity";
import { formatUsdtExact } from "@/lib/usdt-demand-format";
import type { MarketplaceListing, SellerLevel } from "@/types/alpha-exchange";
import { ListingCard } from "./usdt-exchange-page";

type SampleSeller = {
  name: string;
  level: SellerLevel;
  displayNumber: number;
  amount: string;
  price: string;
  trades: number;
  reviews: number;
  responseMinutes: number;
  alphaScore: number;
  phoneVerified: boolean;
  paymentMethods: string[];
};

function sampleListing({ name, level, displayNumber, amount, price, trades, reviews, responseMinutes, alphaScore, phoneVerified, paymentMethods }: SampleSeller): MarketplaceListing {
  const sellerId = `sample-seller-${name.toLowerCase()}`;
  const createdAt = "2026-11-02T09:00:00Z";
  return {
    id: `sample-${displayNumber}`, sellerId, displayNumber, photos: [],
    sellerDisplayName: `${publicAccountId({ id: sellerId })} (${name})`,
    originalAmount: amount, availableAmount: amount, price, currency: "ILS", network: "TRC20",
    paymentMethod: paymentMethods[0], paymentMethods,
    minimumTrade: "100", maximumTrade: amount, sellerDescription: "", responseTime: `${responseMinutes} minutes`,
    status: "active", approvalStatus: "approved", createdAt, updatedAt: createdAt,
    sellerProfile: {
      sellerId, sellerName: name, username: sellerId, profilePhotoUrl: "", memberSince: createdAt,
      languages: ["Arabic", "English"], preferredNetworks: ["TRC20"], bio: "",
      isEmailVerified: true, isPhoneVerified: phoneVerified, onlineStatus: "offline", availabilityStatus: "available",
    },
    sellerReputation: {
      sellerId, level, rating: 5, totalReviews: reviews, completedTrades: trades, tradeRequests: trades,
      responseTimeMinutes: responseMinutes, responseSampleCount: trades, alphaScore: { value: alphaScore, starter: false },
      trustScore: alphaScore, successRate: 99, reliabilityScore: 99, responseScore: 98,
      activityScore: 90, marketplacePosition: 1, reputationSummary: "", acceptanceRate: 99, cancellationRate: 0,
      completionRate: 99, recentActivityScore: 90, accountAgeDays: 365, profileCompletion: 100,
      verificationScore: 100, disputesLost: 0, marketplaceViolations: 0, listingQualityScore: 100,
      badges: [], repeatBuyers: 3,
    },
  };
}

const samples = [
  sampleListing({
    name: "Kasem", level: "silver", displayNumber: 145, amount: "15000.22", price: "3.36",
    trades: 6, reviews: 3, responseMinutes: 11, alphaScore: 47.6, phoneVerified: true,
    paymentMethods: ["Cardless ATM Withdrawal", "Bank Transfer", "Face-to-Face (Meet in Person)"],
  }),
  sampleListing({
    name: "maria", level: "bronze", displayNumber: 148, amount: "50000.99", price: "3.45",
    trades: 5, reviews: 5, responseMinutes: 3, alphaScore: 86.1, phoneVerified: false,
    paymentMethods: ["Face-to-Face (Meet in Person)", "Bank Transfer", "Cardless ATM Withdrawal"],
  }),
];

/** The preview route is local or staging only. All sellers and quantities are fixtures. */
export function ListingDesignPreview({ locale }: { locale: "en" | "ar" }) {
  const isAr = locale === "ar";
  const [cardWidth, setCardWidth] = useState(560);
  const [largeAmount, setLargeAmount] = useState(false);
  const [selection, setSelection] = useState<{ listing: MarketplaceListing; action: string } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const select = (listing: MarketplaceListing, action: string) => {
    setSelection({ listing, action });
    dialog.current?.showModal();
  };

  return (
    <section dir={isAr ? "rtl" : "ltr"} className="mx-auto w-full px-3 pb-24 pt-2 text-white" style={{ maxWidth: cardWidth + 24 }}>
      <header className="mb-2 flex items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold">{isAr ? "عروض USDT" : "USDT listings"}</h1>
        <span className="text-xs text-neutral-400">{isAr ? "بيانات تجريبية" : "Sample listings"}</span>
      </header>
      <div className="grid gap-2">
        {samples.map((sample, index) => {
          const listing = index === 0 && largeAmount
            ? { ...sample, availableAmount: "999999999999.99", originalAmount: "999999999999.99", maximumTrade: "999999999999.99" }
            : sample;
          return (
            <div key={listing.id} onClickCapture={event => {
              // The profile link points to a synthetic identity on this preview.
              const link = event.target instanceof Element ? event.target.closest("a") : null;
              if (!link?.pathname.endsWith(`/exchange/seller/${listing.sellerProfile?.username}`)) return;
              event.preventDefault();
              event.stopPropagation();
              select(listing, isAr ? "ملف البائع" : "Seller Profile");
            }}>
              <ListingCard listing={listing} isAr={isAr} marketPricePerUsdt={3.13265}
                isOwnerListing={false} canViewPrivateIdentity isOwnListing={false} isBuying={false}
                onOpen={(chosen, mode) => select(chosen, mode === "buyer_offer"
                  ? (isAr ? "تقديم عرض سعر" : "Make an Offer")
                  : (isAr ? "شراء الآن" : "Buy Now"))}
                onManageListing={chosen => select(chosen, isAr ? "إدارة العرض" : "Manage Listing")} />
            </div>
          );
        })}
      </div>
      <details className="mt-3 text-xs text-neutral-400">
        <summary className="cursor-pointer">{isAr ? "إعدادات المعاينة" : "Preview settings"}</summary>
        <div className="mt-2 flex flex-wrap items-center gap-4">
          <label>{isAr ? "عرض البطاقة " : "Card width "}<select className="rounded border border-neutral-700 bg-neutral-900 p-1" value={cardWidth}
            onChange={event => setCardWidth(Number(event.target.value))}>
            {[248, 288, 328, 343, 358, 380, 398, 448, 560, 740, 1120].map(width => <option key={width} value={width}>{width}px</option>)}
          </select></label>
          <label><input type="checkbox" checked={largeAmount} onChange={event => setLargeAmount(event.target.checked)} /> {isAr ? "كمية كبيرة" : "Very long amount"}</label>
        </div>
      </details>
      <dialog ref={dialog} aria-labelledby="sample-action" onClose={() => setSelection(null)}
        className="fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-[22rem] rounded-2xl border border-neutral-700 bg-neutral-950 p-5 text-white shadow-xl backdrop:bg-black/70">
        {selection && <>
          <p className="text-xs text-neutral-400">{isAr ? "معاينة محلية" : "Local preview"}</p>
          <h2 id="sample-action" className="mt-1 text-lg font-semibold">{selection.action} · <bdi>{selection.listing.sellerProfile?.sellerName}</bdi></h2>
          <dl className="my-4 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
            <dt>{isAr ? "الكمية المتاحة" : "Available amount"}</dt><dd dir="ltr">{formatUsdtExact(selection.listing.availableAmount)} USDT</dd>
            <dt>{isAr ? "سعر الوحدة" : "Unit price"}</dt><dd dir="ltr">₪{selection.listing.price}</dd>
          </dl>
          <form method="dialog"><button className="rounded-lg bg-neutral-200 px-4 py-2 text-sm font-semibold text-black">{isAr ? "إغلاق" : "Close"}</button></form>
        </>}
      </dialog>
    </section>
  );
}
