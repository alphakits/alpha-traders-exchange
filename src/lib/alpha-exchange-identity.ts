export const ALPHA_EXCHANGE_OWNER_EMAIL = "jozenmark834@yahoo.com";

export function isAlphaExchangeOwnerEmail(email: string) {
  return String(email ?? "").trim().toLowerCase() === ALPHA_EXCHANGE_OWNER_EMAIL;
}
