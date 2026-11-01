import { parseRememberedLoginRequest, type RememberedLogin, type RememberedLoginResponse } from "@alpha-traders/contracts";
import { isTrustedWebsiteDocumentUrl } from "./website-navigation";

type RememberedLoginStorage = {
  load: () => Promise<RememberedLogin | null>;
  save: (credentials: RememberedLogin) => Promise<void>;
  clear: () => Promise<void>;
};

export function isTrustedLoginDocument(url: string) {
  return isTrustedWebsiteDocumentUrl(url) && /^\/(?:en\/|ar\/)?login\/?$/.test(new URL(url).pathname);
}

export async function handleRememberedLoginMessage(url: string, raw: unknown, storage: RememberedLoginStorage): Promise<RememberedLoginResponse | null> {
  if (!isTrustedLoginDocument(url)) return null;
  const request = parseRememberedLoginRequest(raw);
  if (!request) return null;
  const response = { type: "alpha.native.remembered-login", version: 1, requestId: request.requestId } as const;
  try {
    if (request.action === "load") return { ...response, status: "ok", credentials: await storage.load() };
    if (request.action === "save") await storage.save(request.credentials);
    else await storage.clear();
    return { ...response, status: "ok" };
  } catch {
    // Neither the exception nor the credentials may enter diagnostics/logs.
    return { ...response, status: "failed" };
  }
}

export function rememberedLoginReplyScript(url: string, response: RememberedLoginResponse) {
  if (!isTrustedLoginDocument(url)) return null;
  // Check again inside the destination document: a secure-store read can finish
  // after navigation/reload. Only the exact requesting login document receives it.
  return `(function(){if(window.top!==window||window.location.href!==${JSON.stringify(url)}||window.__alphaRememberedLoginRequestId!==${JSON.stringify(response.requestId)})return;window.dispatchEvent(new CustomEvent("alpha-native-remembered-login",{detail:${JSON.stringify(response)}}));})();true;`;
}
