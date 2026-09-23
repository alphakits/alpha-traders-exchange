"use client";

import { parseRememberedLoginResponse, type RememberedLogin, type RememberedLoginRequest, type RememberedLoginResponse } from "@alpha-traders/contracts";
import "@/lib/native-app-bridge";

declare global {
  interface Window { __alphaRememberedLoginRequestId?: string; }
}

export const REMEMBERED_LOGIN_TIMEOUT_MS = 1500;

export function requestAppRememberedLogin(action: "load" | "clear" | "save", credentials?: RememberedLogin): Promise<RememberedLoginResponse | null> {
  if (typeof window === "undefined" || window.top !== window || !window.ReactNativeWebView?.postMessage) return Promise.resolve(null);
  if (action === "save" && !credentials) return Promise.resolve(null);
  const requestId = crypto.randomUUID();
  const request: RememberedLoginRequest = action === "save" && credentials
    ? { type: "alpha.web.remembered-login", version: 1, requestId, action, credentials }
    : { type: "alpha.web.remembered-login", version: 1, requestId, action: action === "load" ? "load" : "clear" };
  return new Promise(resolve => {
    const finish = (response: RememberedLoginResponse | null) => {
      clearTimeout(timer);
      window.removeEventListener("alpha-native-remembered-login", receive);
      if (window.__alphaRememberedLoginRequestId === requestId) delete window.__alphaRememberedLoginRequestId;
      resolve(response);
    };
    const receive = (event: Event) => {
      const response = parseRememberedLoginResponse((event as CustomEvent).detail);
      if (response?.requestId === requestId) finish(response);
    };
    const timer = setTimeout(() => finish(null), REMEMBERED_LOGIN_TIMEOUT_MS);
    window.__alphaRememberedLoginRequestId = requestId;
    window.addEventListener("alpha-native-remembered-login", receive);
    try { window.ReactNativeWebView!.postMessage(JSON.stringify(request)); }
    catch { finish(null); }
  });
}
