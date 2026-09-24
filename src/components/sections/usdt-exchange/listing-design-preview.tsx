"use client";

import { useState } from "react";
import { ListingCard } from "./usdt-exchange-page";
import { PublicAccountId } from "@/components/ui/public-account-id";
import { RoleBadge } from "@/components/ui/role-badge";
import type { MarketplaceListing, SellerLevel } from "@/types/alpha-exchange";

/** The existing preview route blocks this synthetic review surface in production. */
export function ListingDesignPreview({ locale }: { locale: "en" | "ar" }) {
  const [feedback, setFeedback] = useState("");
  const sample = (width: number, rank: SellerLevel, amount: string): MarketplaceListing => ({
    id: `sample-${width}`, sellerId: `sample-seller-${width}`, sellerDisplayName: "AT-100001", displayNumber: 1247, photos: [],
    originalAmount: amount, availableAmount: amount, price: "3.12", currency: "ILS", network: "TRC20",
    paymentMethod: "Bank Transfer", paymentMethods: ["Bank Transfer", "Face-to-Face (Meet in Person)", "Cardless ATM Withdrawal"],
    minimumTrade: "100", maximumTrade: amount, sellerDescription: "Sample listing", responseTime: "4 minutes", status: "active",
    createdAt: "2026-09-24T12:00:00Z", updatedAt: "2026-09-24T12:00:00Z",
    sellerReputation: { sellerId: `sample-seller-${width}`, level: rank, rating: 4.98, completedTrades: 1248,
      responseTimeMinutes: 4, trustScore: 98, successRate: 99, reliabilityScore: 99, responseScore: 98, activityScore: 90, marketplacePosition: 1, reputationSummary: "Sample reputation",
      acceptanceRate: 99, cancellationRate: 0, completionRate: 99, recentActivityScore: 90, accountAgeDays: 365,
      profileCompletion: 100, verificationScore: 100, disputesLost: 0, marketplaceViolations: 0, listingQualityScore: 100,
      badges: [], tradeRequests: 1248, repeatBuyers: 12 },
  });
  return <main className="min-h-screen bg-[#050505] p-4 text-white" dir={locale === "ar" ? "rtl" : "ltr"}>
    <h1 className="text-xl font-semibold">Listing layout review · sample data</h1>
    <div className="my-4 flex flex-wrap items-center gap-3"><PublicAccountId value="AT-084321" /><RoleBadge variant="buyer" locale={locale} /><PublicAccountId value="AT-027419" audience="seller" rank="gold" /><RoleBadge variant="approved_seller" locale={locale} /></div>
    <p role="status" className="mb-4 text-sm">{feedback || "Preview buttons show feedback only."}</p>
    <div className="flex flex-wrap items-start gap-6">
      {([{ width: 288, rank: "bronze", amount: "1250" }, { width: 358, rank: "diamond", amount: "15000" }, { width: 560, rank: "gold", amount: "999999999" }] as const).map(({width, rank, amount}) => <section key={width} style={{ width, maxWidth: "100%" }}>
        <h2 className="mb-3 text-sm">Card width: {width}px</h2>
        <ListingCard listing={sample(width, rank, amount)} isAr={locale === "ar"} marketPricePerUsdt={3.01}
          isOwnerListing={false} isOwnListing={false} isBuying={false}
          onOpen={(_, mode) => setFeedback(mode === "buyer_offer" ? "Offer action selected" : "Buy action selected")}
          onManageListing={() => setFeedback("Manage action selected")} />
      </section>)}
    </div>
  </main>;
}
