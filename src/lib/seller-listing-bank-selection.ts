export function ensurePayoutBankIsSupported(
  selectedBanks: string[],
  payoutBankName?: string | null,
  maxSelectedBanks = 2,
) {
  const uniqueBanks = selectedBanks
    .map((bank) => bank.trim())
    .filter((bank, index, banks) => Boolean(bank) && banks.indexOf(bank) === index);
  const normalizedPayoutBank = payoutBankName?.trim();

  if (!normalizedPayoutBank) return uniqueBanks.slice(0, maxSelectedBanks);

  return [
    normalizedPayoutBank,
    ...uniqueBanks.filter((bank) => bank !== normalizedPayoutBank),
  ].slice(0, maxSelectedBanks);
}

export function isPayoutBankSupported(selectedBanks: string[], payoutBankName?: string | null) {
  const normalizedPayoutBank = payoutBankName?.trim();
  return Boolean(normalizedPayoutBank && selectedBanks.includes(normalizedPayoutBank));
}
