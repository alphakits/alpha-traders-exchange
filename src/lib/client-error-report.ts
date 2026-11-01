export const CLIENT_ERROR_KINDS = ["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "ChunkLoadError", "Other"] as const;
export const CLIENT_ERROR_PAGES = ["trade-room", "marketplace", "dashboard", "account", "other"] as const;
export type ClientErrorReport = {
  reference: string;
  boundary: "global" | "locale";
  kind: typeof CLIENT_ERROR_KINDS[number];
  page: typeof CLIENT_ERROR_PAGES[number];
  digest?: number;
  deployment?: string;
  frames: Array<{ asset: string; line: number; column: number }>;
};

/** Next's public render digest is a uint32, not an error message or user value. */
export function getSafeErrorDigest(error: unknown): number | undefined {
  const digest = error && typeof error === "object" && "digest" in error ? error.digest : undefined;
  if (typeof digest !== "string" || !/^\d{1,10}$/.test(digest)) return undefined;
  const value = Number(digest);
  return value <= 0xffff_ffff ? value : undefined;
}

export function classifyErrorPage(pathname: string): ClientErrorReport["page"] {
  const section = pathname.split("/")[2];
  if (section === "trade-room") return "trade-room";
  if (section === "usdt-exchange") return "marketplace";
  if (section === "dashboard" || section === "admin") return "dashboard";
  if (["login", "register", "profile", "settings"].includes(section)) return "account";
  return "other";
}

/** Retain only built JS asset names/positions; never transmit a raw stack. */
export function getSafeErrorFrames(stack: string | undefined): ClientErrorReport["frames"] {
  const frames: ClientErrorReport["frames"] = [];
  const pattern = /\/_next\/static\/chunks\/(?:[A-Za-z0-9_%[\]-]+\/)*([A-Za-z0-9_-]{1,100}\.js)(?:\?dpl=dpl_[A-Za-z0-9]{1,80})?:(\d{1,7}):(\d{1,7})/g;
  for (const frame of (stack ?? "").slice(0, 20_000).split(/\r?\n/)) {
    // Chrome/V8 and Safari stack frames only. The first line may contain
    // arbitrary private data in the error message, even a URL-shaped value.
    if (!/^\s*at\s|^[^\s:]*@https?:\/\//.test(frame)) continue;
    for (const match of frame.matchAll(pattern)) {
      const line = Number(match[2]);
      const column = Number(match[3]);
      if (line > 0 && column > 0) frames.push({ asset: match[1], line, column });
      if (frames.length === 3) return frames;
    }
  }
  return frames;
}
