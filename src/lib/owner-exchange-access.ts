import { isAlphaExchangeOwnerEmail } from "./alpha-exchange-identity";
import { isPublicOwnerIdentity } from "./public-account-identity";

/** UI capability from the canonical session. Server endpoints independently authorize all private data/actions. */
export function canViewOwnerExchangeIdentity(viewer: Parameters<typeof isPublicOwnerIdentity>[0]) {
  return isPublicOwnerIdentity(viewer) && isAlphaExchangeOwnerEmail(viewer?.email ?? "");
}
