import "server-only";

type PhoneExemptionAccount = {
  id?: string | null;
  email?: string | null;
  disabled?: boolean;
};

// Owner-authorized existing accounts only. Email aliases, recreated accounts,
// roles, client fields, and user-editable auth metadata cannot grant access.
const authorizedAccounts = new Map([
  ["user-030c4619-e1a6-4147-9d91-a8bbd2e2db4a", "alphatradersai@gmail.com"],
  ["user-6f3a0120-5d36-423f-8dee-9a875e8e064e", "claudiahttps11@gmail.com"],
  ["user-cfa3bd2c-25e7-4a9e-9ae5-55ac4900846f", "jozenmark834@yahoo.com"],
]);

export function isAccountPhoneVerificationExempt(account: PhoneExemptionAccount | null | undefined) {
  if (!account?.id || account.disabled === true) return false;
  const email = account.email?.trim().toLowerCase();
  return Boolean(email && authorizedAccounts.get(account.id) === email);
}
