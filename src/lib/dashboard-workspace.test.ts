import { describe, expect, it } from "vitest";
import {
  dashboardActivityTimestamp,
  getCommissionWorkspaceAction,
  sortDashboardActivityNewestFirst,
} from "@/lib/dashboard-workspace";

describe("dashboard workspace helpers", () => {
  it("sorts recent activity by updated time, then creation time", () => {
    const activities = sortDashboardActivityNewestFirst([
      { id: "created-fallback", createdAt: "2026-08-21T12:00:00.000Z" },
      { id: "recent-update", createdAt: "2026-08-20T12:00:00.000Z", updatedAt: "2026-08-21T13:00:00.000Z" },
      { id: "older-update", createdAt: "2026-08-21T15:00:00.000Z", updatedAt: "2026-08-21T11:00:00.000Z" },
    ]);

    expect(activities.map((activity) => activity.id)).toEqual([
      "recent-update",
      "created-fallback",
      "older-update",
    ]);
    expect(dashboardActivityTimestamp({ id: "invalid", updatedAt: "not-a-date", createdAt: "also-not-a-date" })).toBe(0);
  });

  it("keeps same-time activity ordering deterministic", () => {
    const activities = sortDashboardActivityNewestFirst([
      { id: "trade-b", updatedAt: "2026-08-21T12:00:00.000Z" },
      { id: "trade-a", updatedAt: "2026-08-21T12:00:00.000Z" },
    ]);

    expect(activities.map((activity) => activity.id)).toEqual(["trade-a", "trade-b"]);
  });

  it("uses a single exact commission record only when one payable record exists", () => {
    expect(getCommissionWorkspaceAction({
      status: "pending",
      pendingCount: 1,
      payableAmountDue: 3,
      commissionId: "commission-one",
    })).toEqual({ kind: "pay-one", commissionId: "commission-one" });

    expect(getCommissionWorkspaceAction({
      status: "pending",
      pendingCount: 2,
      payableAmountDue: 3,
      commissionId: "commission-one",
    })).toEqual({ kind: "review-unpaid" });
    expect(getCommissionWorkspaceAction({ status: "clear", pendingCount: 0 })).toEqual({ kind: "none" });
    expect(getCommissionWorkspaceAction({
      status: "pending",
      pendingCount: 1,
      payableAmountDue: 3,
      commissionId: "commission-one",
      selectionError: "stale",
    })).toEqual({ kind: "none" });
  });
});
