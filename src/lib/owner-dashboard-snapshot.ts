/** UI read-shape guard only. Does not grant API permission or validate business state. */
export function isOwnerDashboardSnapshot(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  for (const key of ["users", "approvedSellers", "purchaseRequests"] as const) {
    const rows = data[key];
    if (!Array.isArray(rows) || !rows.every(row => row !== null && typeof row === "object"
      && !Array.isArray(row) && typeof row.id === "string" && row.id.trim().length > 0)) return false;
  }
  return true;
}
