import { MAX_SUPPORTED_ISRAELI_BANK_SELECTIONS, parseIsraeliBankSelection, serializeIsraeliBankSelection } from "./israeli-banks";
import { requiresIsraeliBankSelection, requiresSellerPayoutBankAccount } from "./marketplace-payment-methods";

type ListingBankFields = {
  paymentMethods: string[];
  bankAccountId: string;
  bankName: string;
};

/** Keep payout details tied to Bank Transfer, independently of ATM bank choices. */
export function syncListingBankSelection<T extends ListingBankFields>(
  form: T,
  accounts: readonly { id: string; bankName: string; isDefault?: boolean }[],
): T {
  const needsPayoutAccount = requiresSellerPayoutBankAccount(form.paymentMethods);
  const account = needsPayoutAccount
    ? (form.bankAccountId
        ? accounts.find((entry) => entry.id === form.bankAccountId)
        : accounts.find((entry) => entry.isDefault) ?? accounts[0])
    : undefined;
  const bankAccountId = needsPayoutAccount ? account?.id ?? form.bankAccountId : "";
  const bankName = !requiresIsraeliBankSelection(form.paymentMethods)
    ? ""
    : account
      ? serializeIsraeliBankSelection(ensurePayoutBankIsSupported(
          parseIsraeliBankSelection(form.bankName), account.bankName, MAX_SUPPORTED_ISRAELI_BANK_SELECTIONS,
        ))
      : form.bankName;
  return form.bankAccountId === bankAccountId && form.bankName === bankName
    ? form
    : { ...form, bankAccountId, bankName };
}

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
