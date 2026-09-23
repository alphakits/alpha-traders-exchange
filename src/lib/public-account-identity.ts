import { formatBuyerId, formatSellerId } from "@/lib/format-id";
import { redactPrivateContactDetails } from "@/lib/privacy-redaction";

type IdentityUser = { id: string; role?: string; roles?: readonly string[]; sellerStatus?: string; fullName?: string; buyerDisplayName?: string; email?: string; whatsappNumber?: string; disabled?: boolean };

export function isPublicOwnerIdentity(user?: IdentityUser | null) {
  return Boolean(user && !user.disabled && (user.role === "owner" || user.roles?.includes("owner")));
}

/** Owner identity is public; member identities remain their dashboard AT IDs. */
export function publicAccountName(user: IdentityUser) {
  return isPublicOwnerIdentity(user) ? user.fullName?.trim() || "Alpha Traders Owner" : publicAccountId(user);
}

/** Call with a canonical server-resolved viewer, never a client-supplied role. */
export function accountNameForViewer(user: IdentityUser, viewer?: IdentityUser | null) {
  return isPublicOwnerIdentity(viewer) ? user.fullName?.trim() || publicAccountName(user) : publicAccountName(user);
}

/** Restores canonical names in stored AT-ID messages for an authorized owner view. */
export function ownerIdentityText(users: readonly IdentityUser[]) {
  const names = new Map(users.map(user => [publicAccountId(user), user.fullName?.trim() || publicAccountName(user)]));
  return (value?: string) => (value ?? "").replace(/#[SB]-\d+\b/g, id => names.get(id) ?? id);
}

/** The same account identifier used by the dashboard, never a user-entered alias. */
export function publicAccountId(user: IdentityUser) {
  const seller = user.sellerStatus === "approved_seller" || user.sellerStatus === "suspended"
    || (!user.sellerStatus && user.role === "approved_seller") || user.role === "owner" || user.role === "admin"
    || user.roles?.some(role => role === "owner" || role === "admin");
  return seller ? formatSellerId(undefined, user.id) : formatBuyerId(undefined, user.id);
}

/** Redacts known identities in historical free text without touching trade amounts or credentials. */
export function identityTextRedactor(users: readonly IdentityUser[], includeNameParts = false) {
  const aliases = new Map<string, string>();
  const reserved = /^(buyer|seller|owner|admin|member|trader|alpha|test|user|system)$/i;
  for (const user of users) {
    if (isPublicOwnerIdentity(user)) continue;
    const identity = publicAccountId(user);
    for (const name of [user.fullName, user.buyerDisplayName]) {
      if (!name?.trim() || /^#[SB]-\d+$/.test(name) || reserved.test(name.trim())) continue;
      aliases.set(name.trim().normalize("NFKC"), identity);
      for (const part of includeNameParts ? name.trim().split(/\s+/) : []) {
        if (part.length >= 3 && !reserved.test(part)) aliases.set(part.normalize("NFKC"), identity);
      }
    }
  }
  const names = [...aliases.keys()].sort((a, b) => b.length - a.length);
  const pattern = names.length ? new RegExp(`(?<![\\p{L}\\p{N}_])(?:${names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\p{L}\\p{N}_])`, "giu") : null;
  const insensitiveAliases = new Map([...aliases].map(([name, id]) => [name.toLocaleLowerCase(), id]));
  return (value: string | undefined) => {
    const text = redactPrivateContactDetails(String(value ?? "").normalize("NFKC"));
    return pattern ? text.replace(pattern, name => insensitiveAliases.get(name.toLocaleLowerCase()) ?? "[private name removed]") : text;
  };
}
