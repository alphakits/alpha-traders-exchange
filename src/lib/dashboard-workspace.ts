export type DashboardActivity = {
  id: string;
  updatedAt?: string | null;
  createdAt?: string | null;
};

export type PayableCommissionStatus = {
  status: "clear" | "pending" | "overdue";
  pendingCount: number;
  payableAmountDue?: number;
  commissionId?: string;
  selectionError?: string;
};

export type CommissionWorkspaceAction =
  | { kind: "none" }
  | { kind: "pay-one"; commissionId: string }
  | { kind: "review-unpaid" };

function parseActivityDate(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Dashboard activity is deliberately ordered by the latest known activity,
 * with creation time as the deterministic fallback. Status priority is shown
 * through badges, not used to hide newer work lower in the stack.
 */
export function dashboardActivityTimestamp(activity: DashboardActivity) {
  return parseActivityDate(activity.updatedAt)
    ?? parseActivityDate(activity.createdAt)
    ?? 0;
}

export function sortDashboardActivityNewestFirst<T extends DashboardActivity>(activities: readonly T[]) {
  return [...activities].sort((left, right) => {
    const timestampDelta = dashboardActivityTimestamp(right) - dashboardActivityTimestamp(left);
    if (timestampDelta !== 0) return timestampDelta;
    return left.id.localeCompare(right.id);
  });
}

/**
 * A dashboard card may only target a canonical server-owned commission record.
 * Aggregate outstanding balances are never payment targets.
 */
export function getCommissionWorkspaceAction(status: PayableCommissionStatus | null | undefined): CommissionWorkspaceAction {
  if (!status || status.status === "clear" || status.selectionError || status.pendingCount < 1) {
    return { kind: "none" };
  }

  if (
    status.pendingCount === 1
    && typeof status.payableAmountDue === "number"
    && status.payableAmountDue > 0
    && status.commissionId?.trim()
  ) {
    return { kind: "pay-one", commissionId: status.commissionId.trim() };
  }

  return { kind: "review-unpaid" };
}
