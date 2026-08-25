import type { MarketplaceListing, PurchaseRequest } from "@/types/alpha-exchange";
import { buildTradeRoomDestination } from "@/lib/trade-room-destination";
import { normalizePublicProfileUsername } from "@/lib/public-profile-username";

export const ADMIN_DASHBOARD_SECTIONS = [
  "overview",
  "seller-applications",
  "approved-sellers",
  "seller-rank",
  "marketplace-listings",
  "listing-reliability",
  "purchase-requests",
  "commissions",
  "audit-logs",
  "sms-deliveries",
  "marketplace-enforcement",
  "announcements",
  "private-beta",
  "settings",
  "users",
  "reviews",
  "analytics",
  "emergency",
] as const;

export type AdminDashboardSection = (typeof ADMIN_DASHBOARD_SECTIONS)[number];

export type AdminDashboardDestination = {
  section: AdminDashboardSection;
  sellerApplicationId?: string;
  listingId?: string;
  listingStatus?: MarketplaceListing["status"];
  purchaseRequestId?: string;
  commissionId?: string;
};

type SearchParamsReader = Pick<URLSearchParams, "get">;

const ADMIN_ENTITY_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,191}$/;
const MARKETPLACE_LISTING_STATUSES: readonly MarketplaceListing["status"][] = [
  "draft",
  "active",
  "paused",
  "matched",
  "in_trade",
  "expired",
  "completed",
  "cancelled",
  "closed",
];

function normalizeAdminEntityId(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return ADMIN_ENTITY_ID_PATTERN.test(normalized) ? normalized : undefined;
}

function isAdminDashboardSection(value: string | null): value is AdminDashboardSection {
  return Boolean(value && (ADMIN_DASHBOARD_SECTIONS as readonly string[]).includes(value));
}

function normalizeListingStatus(value: string | null) {
  return MARKETPLACE_LISTING_STATUSES.includes(value as MarketplaceListing["status"])
    ? value as MarketplaceListing["status"]
    : undefined;
}

function adminDashboardDestination(
  section: AdminDashboardSection,
  entity?: { key: "sellerApplication" | "listing" | "requestId" | "commissionId"; id: string },
) {
  const entityId = normalizeAdminEntityId(entity?.id);
  const query = entityId && entity ? `&${entity.key}=${encodeURIComponent(entityId)}` : "";
  return `/admin/alpha-exchange?section=${section}${query}`;
}

/**
 * Parses only known admin sections and bounded server entity identifiers.  This
 * keeps notification/action destinations deterministic without treating a URL
 * query string as an instruction to render an arbitrary admin state.
 */
export function parseAdminDashboardDestination(searchParams: SearchParamsReader): AdminDashboardDestination {
  const sellerApplicationId = normalizeAdminEntityId(searchParams.get("sellerApplication"));
  const listingId = normalizeAdminEntityId(searchParams.get("listing"));
  const purchaseRequestId = normalizeAdminEntityId(searchParams.get("requestId") ?? searchParams.get("request"));
  const commissionId = normalizeAdminEntityId(searchParams.get("commissionId") ?? searchParams.get("commission"));
  const requestedSection = searchParams.get("section");
  const legacyListingsTab = searchParams.get("tab") === "listings";
  const section = isAdminDashboardSection(requestedSection)
    ? requestedSection
    : sellerApplicationId
      ? "seller-applications"
      : listingId
        ? "marketplace-listings"
        : legacyListingsTab
          ? "marketplace-listings"
        : purchaseRequestId
          ? "purchase-requests"
          : commissionId
            ? "commissions"
            : "overview";

  if (section === "seller-applications") {
    return { section, ...(sellerApplicationId ? { sellerApplicationId } : {}) };
  }
  if (section === "marketplace-listings") {
    const listingStatus = normalizeListingStatus(searchParams.get("status"));
    return {
      section,
      ...(listingId ? { listingId } : {}),
      ...(listingStatus ? { listingStatus } : {}),
    };
  }
  if (section === "purchase-requests") {
    return { section, ...(purchaseRequestId ? { purchaseRequestId } : {}) };
  }
  if (section === "commissions") {
    return { section, ...(commissionId ? { commissionId } : {}) };
  }
  return { section };
}

export function listingDestination(listing: Pick<MarketplaceListing, "id">) {
  return `/usdt-exchange#listing-${encodeURIComponent(listing.id)}`;
}

export function sellerListingWorkspaceAnchor(listing: Pick<MarketplaceListing, "id">) {
  return `seller-listing-${encodeURIComponent(listing.id)}`;
}

export function sellerListingWorkspaceDestination(listing: Pick<MarketplaceListing, "id">) {
  return `/usdt-exchange#${sellerListingWorkspaceAnchor(listing)}`;
}

export function sellerApplicationStatusDestination() {
  return "/usdt-exchange#seller-application";
}

export function sellerProfileDestination(username: string) {
  return `/exchange/seller/${encodeURIComponent(normalizePublicProfileUsername(username))}`;
}

export function sellerApplicationReviewDestination(applicationId: string) {
  return adminDashboardDestination("seller-applications", { key: "sellerApplication", id: applicationId });
}

export function adminMarketplaceListingsDestination(listingId?: string) {
  return adminDashboardDestination(
    "marketplace-listings",
    listingId ? { key: "listing", id: listingId } : undefined,
  );
}

export function adminMarketplaceEnforcementDestination() {
  return adminDashboardDestination("marketplace-enforcement");
}

export function adminCommissionDestination(commissionId?: string) {
  return adminDashboardDestination(
    "commissions",
    commissionId ? { key: "commissionId", id: commissionId } : undefined,
  );
}

export function adminPurchaseRequestsDestination(purchaseRequestId?: string) {
  return adminDashboardDestination(
    "purchase-requests",
    purchaseRequestId ? { key: "requestId", id: purchaseRequestId } : undefined,
  );
}

export function tradeDestination(request: PurchaseRequest, actorUserId: string) {
  if (request.status === "review_open" || request.status === "completed" || request.status === "locked") {
    return request.buyerId === actorUserId
      ? buildTradeRoomDestination(request, actorUserId)
      : completedTradeDestination(request);
  }
  return buildTradeRoomDestination(request, actorUserId);
}

export function completedTradeDestination(request: PurchaseRequest) {
  return `/usdt-exchange?trade=${encodeURIComponent(request.id)}#my-trade-requests-section`;
}
