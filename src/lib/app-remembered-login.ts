"use client";

import { parseRememberedLoginResponse, type RememberedLogin, type RememberedLoginRequest, type RememberedLoginResponse } from "@alpha-traders/contracts";
import "@/lib/native-app-bridge";

declare global {
  interface Window { __alphaRememberedLoginRequestId?: string; }
}

export const REMEMBERED_LOGIN_TIMEOUT_MS = 1500;

export function requestAppRememberedLogin(action: "load" | "clear" | "save", credentials?: RememberedLogin, signal?: AbortSignal): Promise<RememberedLoginResponse | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  const requestWindow = window;
  const nativeBridge = requestWindow.ReactNativeWebView;
  if (requestWindow.top !== requestWindow || !nativeBridge?.postMessage || signal?.aborted) return Promise.resolve(null);
  if (action === "save" && !credentials) return Promise.resolve(null);
  const requestId = crypto.randomUUID();
  const request: RememberedLoginRequest = action === "save" && credentials
    ? { type: "alpha.web.remembered-login", version: 1, requestId, action, credentials }
    : { type: "alpha.web.remembered-login", version: 1, requestId, action: action === "load" ? "load" : "clear" };
  return new Promise(resolve => {
    let settled = false;
    const finish = (response: RememberedLoginResponse | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      requestWindow.removeEventListener("alpha-native-remembered-login", receive);
      if (requestWindow.__alphaRememberedLoginRequestId === requestId) delete requestWindow.__alphaRememberedLoginRequestId;
      resolve(response);
    };
    const receive = (event: Event) => {
      const response = parseRememberedLoginResponse((event as CustomEvent).detail);
      if (response?.requestId === requestId) finish(response);
    };
    const cancel = () => finish(null);
    const timer = setTimeout(() => finish(null), REMEMBERED_LOGIN_TIMEOUT_MS);
    requestWindow.__alphaRememberedLoginRequestId = requestId;
    requestWindow.addEventListener("alpha-native-remembered-login", receive);
    signal?.addEventListener("abort", cancel, { once: true });
    try { nativeBridge.postMessage(JSON.stringify(request)); }
    catch { finish(null); }
  });
}
