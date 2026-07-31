"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BadgeCheck, Clock3, History, ShieldCheck, Star } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MarketplaceListing, PurchaseRequest } from "@/types/alpha-exchange";

type Payload = {
  pendingListings: MarketplaceListing[];
  allListings: MarketplaceListing[];
  purchaseRequests: PurchaseRequest[];
};

export function OwnerPendingListingsDashboard() {
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
      if (!response.ok) throw new Error(json.error || "Failed to load pending listings.");
      setData(json);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to load pending listings.");
    } finally {
      setLoading(false);
    }
  }, []);

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
      pushToast("Reason is required for reject/request changes.");
      return;
    }
    const response = await fetch(`/api/alpha-exchange/admin/listings/${listingId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, reason }),
    });
    const json = (await response.json()) as { error?: string };
    if (!response.ok) {
      pushToast(json.error || "Action failed.");
      return;
    }
    pushToast(action === "approve" ? "Listing approved." : action === "reject" ? "Listing rejected." : "Changes requested.");
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
    <section className="section-container page-shell">
      <Card className="border-white/10 bg-[#0B0B0B]/95">
        <CardHeader>
          <CardTitle>Pending Listings (Owner Review)</CardTitle>
          <CardDescription>Only the owner can approve, reject, or request changes before listings go live.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? <p className="text-sm text-[#9CA3AF]">Loading pending listings...</p> : null}
          {error ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-[#FDE68A]">{error}</div>
          ) : null}
          {!loading && !error && data.pendingListings.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-[#9CA3AF]">No pending listings to review.</div>
          ) : null}

          {data.pendingListings.map((listing) => (
            <Card key={listing.id} className="border-white/10 bg-black/20">
              <CardContent className="space-y-4 p-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2 text-sm text-[#D1D5DB]">
                    <p className="text-base font-semibold text-white">{listing.sellerDisplayName}</p>
                    <p className="inline-flex items-center gap-2"><Star className="h-4 w-4 text-[#C9A227]" /> Seller Rating: <span className="text-white">{listing.sellerReputation?.rating.toFixed(2) ?? "—"}</span></p>
                    <p>Seller Trust Score: <span className="text-white">{Math.round(listing.sellerReputation?.customerSatisfaction ?? 0)}%</span></p>
                    <p>Seller Level: <span className="text-white capitalize">{listing.sellerReputation?.level ?? "bronze"}</span></p>
                    <p>Lifetime Completed Trades: <span className="text-white">{(listing.sellerReputation?.completedTrades ?? 0).toLocaleString("en-IL")}</span></p>
                    <p>Amount: <span className="text-white">{listing.availableAmount}</span></p>
                    <p>Price: <span className="text-white">{listing.price}</span></p>
                    <p>Currency: <span className="text-white">{listing.currency || "ILS"}</span></p>
                    <p>Network: <span className="text-white">{listing.network}</span></p>
                    <p>Payment Method: <span className="text-white">{listing.paymentMethod || "Not provided"}</span></p>
                    <p>Seller Description: <span className="text-white">{listing.sellerDescription || "Not provided"}</span></p>
                  </div>
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      {(listing.photos?.length ? listing.photos : ["/images/brand/alpha-traders-logo.png"]).slice(0, 4).map((photo, index) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={`${listing.id}-photo-${index}`} src={photo} alt={`Listing ${listing.id} photo ${index + 1}`} className="h-24 w-full rounded-lg border border-white/10 object-cover" />
                      ))}
                    </div>
                    <Input
                      value={reasonByListingId[listing.id] ?? ""}
                      onChange={(event) => setReasonByListingId((prev) => ({ ...prev, [listing.id]: event.target.value }))}
                      placeholder="Reason (required for reject/request changes)"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" onClick={() => runDecision(listing.id, "approve")}><BadgeCheck className="h-4 w-4" />Approve</Button>
                      <Button type="button" size="sm" variant="secondary" onClick={() => runDecision(listing.id, "reject")}><AlertTriangle className="h-4 w-4" />Reject</Button>
                      <Button type="button" size="sm" variant="secondary" onClick={() => runDecision(listing.id, "request_changes")}><Clock3 className="h-4 w-4" />Request Changes</Button>
                      <Button type="button" size="sm" variant="secondary" onClick={() => setSelectedSellerId(listing.sellerId)}><ShieldCheck className="h-4 w-4" />View Seller Profile</Button>
                      <Button type="button" size="sm" variant="secondary" onClick={() => setSelectedSellerId(listing.sellerId)}><History className="h-4 w-4" />View Seller History</Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {sellerHistory ? (
            <Card className="border-white/10 bg-black/20">
              <CardHeader>
                <CardTitle className="text-lg">Seller Profile & History</CardTitle>
                <CardDescription>Review seller profile details and trading history before decision.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm text-[#D1D5DB] md:grid-cols-2">
                <p>Seller: <span className="text-white">{sellerHistory.listing?.sellerDisplayName ?? "—"}</span></p>
                <p>Member Since: <span className="text-white">{sellerHistory.listing?.sellerProfile?.memberSince ? new Date(sellerHistory.listing.sellerProfile.memberSince).getFullYear() : "—"}</span></p>
                <p>Online Status: <span className="text-white">{sellerHistory.listing?.sellerProfile?.onlineStatus ?? "offline"}</span></p>
                <p>Languages: <span className="text-white">{sellerHistory.listing?.sellerProfile?.languages.join(", ") || "—"}</span></p>
                <p>Total Listings: <span className="text-white">{sellerHistory.sellerListings.length}</span></p>
                <p>Completed Trades: <span className="text-white">{sellerHistory.completedTrades}</span></p>
                <p>Pending Requests: <span className="text-white">{sellerHistory.pendingTrades}</span></p>
              </CardContent>
            </Card>
          ) : null}
        </CardContent>
      </Card>
      {toast ? (
        <div className="fixed bottom-4 right-4 rounded-full border border-[#C9A227]/35 bg-[#0B0B0B]/95 px-4 py-2 text-sm text-[#F3D98B] shadow-xl">{toast}</div>
      ) : null}
    </section>
  );
}
