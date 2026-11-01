/** Every deliberate manual assignment has one durable client operation ID. */
export function requireManualCommissionOperationId(value: unknown): string {
  const id = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)) {
    throw new Error("A valid commission operation ID is required. Refresh the owner dashboard before submitting.");
  }
  return id;
}
