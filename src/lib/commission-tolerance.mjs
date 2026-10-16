// Shared by server policy, response metadata and browser validation.
// Apply once to the combined base commission total, never once per invoice.
export const COMMISSION_TOLERANCE_USDT = 2;
export const COMMISSION_TOLERANCE_MICROS = COMMISSION_TOLERANCE_USDT * 1_000_000;
