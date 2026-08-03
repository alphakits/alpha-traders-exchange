/**
 * POST /api/admin/clean-test-accounts
 *
 * Removes all database accounts EXCEPT the 3 production test accounts.
 * Also removes all records exclusively linked to deleted accounts.
 *
 * Kept accounts:
 *   jozenmark834@yahoo.com  (Owner)
 *   marksally11@yahoo.com   (Approved Seller)
 *   jozenmark@gmail.com     (Buyer)
 *
 * Protected by x-setup-secret header (or localhost-only without the header).
 * Call GET first to preview what will be deleted before committing.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import { invalidateAlphaExchangeStoreCache } from "@/lib/alpha-exchange-store";

const SETUP_SECRET = process.env.ALPHA_SETUP_SECRET;

const KEPT_EMAILS = new Set([
  "jozenmark834@yahoo.com",
  "marksally11@yahoo.com",
  "jozenmark@gmail.com",
]);

function isAuthorized(request: NextRequest): boolean {
  const providedSecret = request.headers.get("x-setup-secret");

  if (process.env.NODE_ENV === "production") {
    // The Host header is client-controlled and cannot be trusted in production,
    // and this endpoint deletes accounts. Require an explicitly configured secret
    // that matches the presented header — no default, no host bypass.
    return Boolean(SETUP_SECRET) && providedSecret === SETUP_SECRET;
  }

  // Local/dev convenience: allow localhost, or the configured/default secret.
  const host = request.headers.get("host") ?? "";
  const isLocalhost = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const devSecret = SETUP_SECRET ?? "alpha-setup-localhost";
  return isLocalhost || providedSecret === devSecret;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

/** Preview what would be deleted without committing */
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const repository = await getAlphaExchangeRepository();
  const db = await repository.loadSnapshot();

  const deletedUsers = db.users.filter((u) => !KEPT_EMAILS.has(normalizeEmail(u.email)));
  const deletedIds = new Set(deletedUsers.map((u) => u.id));
  const keptUsers = db.users.filter((u) => KEPT_EMAILS.has(normalizeEmail(u.email)));

  return NextResponse.json(
    {
      wouldDelete: {
        users: deletedUsers.map((u) => ({ email: u.email, role: u.role, id: u.id })),
        sellerApplications: db.sellerApplications.filter((a) => deletedIds.has(a.userId)).length,
        listings: db.marketplaceListings.filter((l) => deletedIds.has(l.sellerId)).length,
        purchaseRequests: db.purchaseRequests.filter(
          (r) => deletedIds.has(r.buyerId) && deletedIds.has(r.sellerId)
        ).length,
        commissionRecords: db.commissionRecords.filter((c) => deletedIds.has(c.sellerId)).length,
        notifications: db.notifications.filter((n) => deletedIds.has(n.userId)).length,
        authSessions: db.authSessions.filter((s) => deletedIds.has(s.userId)).length,
      },
      wouldKeep: keptUsers.map((u) => ({ email: u.email, role: u.role })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/** Commit the deletion */
export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const repository = await getAlphaExchangeRepository();
  const db = await repository.loadSnapshot();

  const deletedUsers = db.users.filter((u) => !KEPT_EMAILS.has(normalizeEmail(u.email)));
  const deletedIds = new Set(deletedUsers.map((u) => u.id));

  const counts = {
    users: deletedUsers.length,
    sellerApplications: 0,
    listings: 0,
    purchaseRequests: 0,
    commissionRecords: 0,
    notifications: 0,
    authSessions: 0,
    activityLog: 0,
    tradeMessages: 0,
    tradeEvidenceFiles: 0,
    disputes: 0,
    sellerReports: 0,
    trustSnapshots: 0,
    sellerReviews: 0,
  };

  // Remove users not in keep list
  db.users = db.users.filter((u) => KEPT_EMAILS.has(normalizeEmail(u.email)));

  // Remove seller applications belonging exclusively to deleted users
  const prevApplications = db.sellerApplications.length;
  db.sellerApplications = db.sellerApplications.filter((a) => !deletedIds.has(a.userId));
  counts.sellerApplications = prevApplications - db.sellerApplications.length;

  // Remove marketplace listings created by deleted users
  const prevListings = db.marketplaceListings.length;
  db.marketplaceListings = db.marketplaceListings.filter((l) => !deletedIds.has(l.sellerId));
  counts.listings = prevListings - db.marketplaceListings.length;

  // Remove purchase requests where BOTH buyer and seller were deleted
  // (keep any trade that involved a kept user on either side)
  const prevRequests = db.purchaseRequests.length;
  db.purchaseRequests = db.purchaseRequests.filter(
    (r) => !deletedIds.has(r.buyerId) || !deletedIds.has(r.sellerId)
  );
  counts.purchaseRequests = prevRequests - db.purchaseRequests.length;

  // Remove commission records for deleted sellers
  const prevCommissions = db.commissionRecords.length;
  db.commissionRecords = db.commissionRecords.filter((c) => !deletedIds.has(c.sellerId));
  counts.commissionRecords = prevCommissions - db.commissionRecords.length;

  // Remove notifications for deleted users
  const prevNotifications = db.notifications.length;
  db.notifications = db.notifications.filter((n) => !deletedIds.has(n.userId));
  counts.notifications = prevNotifications - db.notifications.length;

  // Remove auth sessions for deleted users
  const prevSessions = db.authSessions.length;
  db.authSessions = db.authSessions.filter((s) => !deletedIds.has(s.userId));
  counts.authSessions = prevSessions - db.authSessions.length;

  // Remove activity log entries for deleted users
  if (db.activityLog) {
    const prev = db.activityLog.length;
    db.activityLog = db.activityLog.filter(
      (e) => !deletedIds.has((e as { userId?: string }).userId ?? "")
    );
    counts.activityLog = prev - db.activityLog.length;
  }

  // Remove trade messages for removed purchase requests
  const keptRequestIds = new Set(db.purchaseRequests.map((r) => r.id));
  if (db.tradeMessages) {
    const prev = db.tradeMessages.length;
    db.tradeMessages = db.tradeMessages.filter((m) => keptRequestIds.has(m.purchaseRequestId));
    counts.tradeMessages = prev - db.tradeMessages.length;
  }

  // Remove trade evidence files for removed purchase requests
  if (db.tradeEvidenceFiles) {
    const prev = db.tradeEvidenceFiles.length;
    db.tradeEvidenceFiles = db.tradeEvidenceFiles.filter((f) => keptRequestIds.has(f.purchaseRequestId));
    counts.tradeEvidenceFiles = prev - db.tradeEvidenceFiles.length;
  }

  // Remove disputes for removed purchase requests
  if (db.disputes) {
    const prev = db.disputes.length;
    db.disputes = db.disputes.filter((d) => keptRequestIds.has(d.purchaseRequestId));
    counts.disputes = prev - db.disputes.length;
  }

  // Remove seller reports for deleted users (reporter or reported seller)
  if (db.sellerReports) {
    const prev = db.sellerReports.length;
    db.sellerReports = db.sellerReports.filter(
      (r) => !deletedIds.has(r.sellerId) && !deletedIds.has(r.reporterUserId)
    );
    counts.sellerReports = prev - db.sellerReports.length;
  }

  // Remove trust snapshots for deleted sellers
  if (db.trustSnapshots) {
    const prev = db.trustSnapshots.length;
    db.trustSnapshots = db.trustSnapshots.filter((t) => !deletedIds.has(t.sellerId));
    counts.trustSnapshots = prev - db.trustSnapshots.length;
  }

  // Remove seller reviews for removed purchase requests
  if (db.sellerReviews) {
    const prev = db.sellerReviews.length;
    db.sellerReviews = db.sellerReviews.filter(
      (r) => !deletedIds.has(r.buyerId) && !deletedIds.has(r.sellerId)
    );
    counts.sellerReviews = prev - db.sellerReviews.length;
  }

  await repository.saveSnapshot(db);
  invalidateAlphaExchangeStoreCache();

  return NextResponse.json(
    {
      ok: true,
      deleted: counts,
      keptEmails: Array.from(KEPT_EMAILS),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
