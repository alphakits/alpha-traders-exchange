/** Preserve a safe room link during login; the destination authorizes access. */
export function isTradeRoomEntryPath(path: string | null | undefined) {
  if (!path || /[\\\u0000-\u0020]/.test(path)) return false;
  return /^\/(?:ar\/|en\/)?trade-room(?:\/|[?#]|$)/.test(path);
}
