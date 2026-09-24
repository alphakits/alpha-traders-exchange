"use client";
import { useEffect, useState } from "react";
import { UsdtExchangePage } from "@/components/sections/usdt-exchange/usdt-exchange-page";
import { CanonicalSessionProvider } from "@/components/auth/canonical-session-provider";

const seller = {
  id: "visual-fixture-seller", fullName: "Preview Seller", email: "preview@example.test",
  role: "approved_seller" as const, roles: ["approved_seller" as const, "buyer" as const],
  sellerStatus: "approved_seller" as const, sellerApprovalVerified: true,
  whatsappNumber: "", preferredNetworks: [], preferredPaymentMethods: ["Cardless ATM Withdrawal"],
  profilePhotoUrl: "", languages: ["English"], bio: "", country: "Israel", city: "",
  onlineStatus: "online" as const, availabilityStatus: "available" as const,
  createdAt: "2026-09-04T00:00:00.000Z",
};
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}
export default function ListingVisualFixture({ locale }: { locale: "en" | "ar" }) {
  const [ready, setReady] = useState(false);
  const [submitted, setSubmitted] = useState("");
  useEffect(() => {
    const originalFetch = window.fetch;
    const originalEvents = window.EventSource;
    window.fetch = async (input, init) => {
      const url = String(input);
      // This isolated preview never calls an API or sends real notifications.
      if (!url.includes("/api/")) return originalFetch(input, init);
      if (url.includes("/auth/me")) return json({ user: seller });
      if (url.includes("/seller-settings")) return json({ bankAccounts: [] });
      if (url.includes("/my-listings")) return json({
        listings: [], summary: { activeListingLimit: 3, openListingCount: 0, openTradeCount: 0, pendingCommissionCount: 0, canCreateListing: true, blockedReason: null },
        commissionStatus: { status: "clear", pendingCount: 0, amountDue: 0, totalAmountDue: 0, payableRecords: [] },
      });
      if (url.includes("/alpha-exchange/listings") && init?.method === "POST") {
        setSubmitted(String(init.body));
        return json({ listing: { id: "fictional-listing", status: "draft", approvalStatus: "pending" } }, 201);
      }
      if (url.includes("/listings")) return json({ listings: [] });
      if (url.includes("/purchase-requests")) return json({ requests: [] });
      if (url.includes("/notifications")) return json({ notifications: [], activity: [], unreadCount: 0 });
      if (url.includes("/seller-application")) return json({ application: null });
      if (url.includes("/discord-sharing")) return json({ linked: false, available: false, listings: [] });
      return json({});
    };
    window.EventSource = class { addEventListener() {} removeEventListener() {} close() {} } as unknown as typeof EventSource;
    setReady(true);
    return () => { window.fetch = originalFetch; window.EventSource = originalEvents; };
  }, []);
  return <><p style={{ padding: 12 }}>Isolated visual fixture — fictional data, no live submissions</p>
    {ready ? <CanonicalSessionProvider initialSessionUser={seller} locale={locale}>
      <UsdtExchangePage locale={locale} initialSessionUser={seller} workspaceMode="seller" />
    </CanonicalSessionProvider> : null}
    <pre data-testid="fixture-submitted">{submitted}</pre>
  </>;
}
