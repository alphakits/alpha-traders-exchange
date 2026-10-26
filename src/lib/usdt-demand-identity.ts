import type { AlphaExchangeDb, SellerLevel } from "@/types/alpha-exchange";
import type { DemandPublicIdentity } from "@/types/usdt-demand";
import { isPublicOwnerIdentity, publicAccountId, publicAccountName } from "@/lib/public-account-identity";
import { publicAccountUsername } from "@/lib/public-account-username";
import { isOwnerApprovedSeller } from "@/lib/seller-approval";
import { resolveSellerPrestigeRankWithFloor, SELLER_PRESTIGE_TIERS } from "@/lib/seller-prestige";
import { calculateSellerTrustSnapshot } from "@/lib/trust-engine";
import { getBuyerPrestigeProgress } from "@/lib/buyer-rank";

function groupBy<T>(rows: readonly T[], key: (row: T) => string) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const group = groups.get(id);
    if (group) group.push(row);
    else groups.set(id, [row]);
  }
  return groups;
}

/** Match the existing public profile identity, visibility and prestige rules.
 * No private account fields are copied into this deliberately small DTO. */
export function demandIdentityProjector(db: AlphaExchangeDb, viewerId: string) {
  const users = new Map(db.users.map(user => [user.id, user]));
  const viewer = users.get(viewerId);
  const identities = new Map<string, DemandPublicIdentity>();
  const requestsBySeller = groupBy(db.purchaseRequests, request => request.sellerId);
  const listingsBySeller = groupBy(db.marketplaceListings, listing => listing.sellerId);
  const commissionsBySeller = groupBy(db.commissionRecords, record => record.sellerId);
  const purchasesByBuyer = new Map<string, { count: number; volumeUsdt: number }>();
  for (const request of db.purchaseRequests) {
    // Keep the evidence boundary identical to the public profile's purchase
    // count. Pending sales and a cached seller rank cannot earn buyer progress.
    if (request.status !== "completed" && !request.completedAt) continue;
    const purchases = purchasesByBuyer.get(request.buyerId) ?? { count: 0, volumeUsdt: 0 };
    const amount = Number(request.usdtAmount);
    purchases.count += 1;
    if (Number.isFinite(amount) && amount > 0) purchases.volumeUsdt += amount;
    purchasesByBuyer.set(request.buyerId, purchases);
  }
  const profileOwners = new Map<string, string | null>();
  for (const user of db.users) {
    const username = publicAccountUsername(user.id);
    profileOwners.set(username, profileOwners.has(username) ? null : user.id);
  }
  const knownRank = (value: SellerLevel | undefined) => SELLER_PRESTIGE_TIERS.some(tier => tier.rank === value) ? value : undefined;

  return (userId: string): DemandPublicIdentity => {
    const cached = identities.get(userId);
    if (cached) return cached;
    const user = users.get(userId);
    const accountId = publicAccountId({ id: userId });
    const subjectIsOwner = isPublicOwnerIdentity(user);
    const canBypassVisibility = userId === viewerId || isPublicOwnerIdentity(viewer) || subjectIsOwner;
    const blocked = Boolean(viewer?.blockedUserIds?.includes(userId) || user?.blockedUserIds?.includes(viewerId));
    const profileVisible = Boolean(user && !user.disabled && !blocked
      && (canBypassVisibility || (user.isProfileHidden !== true && user.allowProfileSearch !== false)));
    const username = publicAccountUsername(userId);
    const profileHref = profileVisible && profileOwners.get(username) === userId ? `/u/${encodeURIComponent(username)}` : null;
    const approvedSeller = Boolean(profileVisible && user && isOwnerApprovedSeller(user));
    let sellerRank: SellerLevel | null = null;
    if (approvedSeller && user) {
      const reputation = calculateSellerTrustSnapshot({
        seller: user,
        listings: listingsBySeller.get(userId) ?? [],
        requests: requestsBySeller.get(userId) ?? [],
        commissions: commissionsBySeller.get(userId) ?? [],
        enforcementRecords: db.marketplaceEnforcementRecords,
      });
      const volume = Math.max(reputation.totalUsdtVolume, user.lifetimeCompletedVolumeUsdt ?? 0);
      sellerRank = knownRank(user.sellerRankOverride?.rank) ?? resolveSellerPrestigeRankWithFloor(volume, knownRank(user.sellerPrestigeRank));
    }
    const showStats = profileVisible && user && (user.showTradeStats !== false || canBypassVisibility);
    const purchases = purchasesByBuyer.get(userId);
    // Buyer profile progress uses completed purchase volume rounded to two
    // decimal places. Use its shared rank policy, but expose only public badges.
    const progress = showStats ? getBuyerPrestigeProgress(Number((purchases?.volumeUsdt ?? 0).toFixed(2))) : null;
    const identity: DemandPublicIdentity = {
      // Member real names and buyerDisplayName are private under the site's
      // existing policy. Keep cards identical to their actual public profile.
      displayName: user ? publicAccountName(user) : accountId,
      accountId,
      profileHref,
      approvedSeller,
      sellerRank,
      completedPurchases: showStats ? purchases?.count ?? 0 : null,
      buyerProgress: progress ? {
        rank: progress.rank,
        nextRank: progress.nextRank ?? null,
        progressPercent: Number(progress.progressPercent.toFixed(2)),
      } : null,
    };
    identities.set(userId, identity);
    return identity;
  };
}
